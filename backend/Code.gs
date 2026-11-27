/**
 * Kotletka — backend for Google Sheets + Apps Script.
 *
 * The Sheet is the database. This script is the API: the web app sends
 * POST requests with JSON {action, token, ...} and gets JSON back.
 *
 * First-time setup (see docs-private/DEVELOPER.md):
 *   1. Paste this file into Extensions → Apps Script of an empty Google Sheet.
 *   2. Check GOOGLE_CLIENT_ID below (same value as js/config.js).
 *   3. Run `setup` once (creates tabs, photo folder, makes you the admin).
 *   4. Optionally run `importPlacesFromOSM` to load Krasnoyarsk cafes/restaurants.
 *   5. Deploy → New deployment → Web app (Execute as: Me, Access: Anyone).
 */

// ===== CONFIG =====
const GOOGLE_CLIENT_ID = '24586340664-q5g745dadhlhpm7r8qojpo2h8qlglcf1.apps.googleusercontent.com'; // same as js/config.js

// Krasnoyarsk bounding box: south, west, north, east
const CITY_BBOX = [55.94, 92.60, 56.13, 93.20];

const SCHEMA = {
  // badges_shown = badges already celebrated for this user (comma-separated ids; '-' = none yet; empty = not started)
  Users:   ['id', 'email', 'name', 'role', 'created_at', 'avatar_id', 'badges_shown'],
  // type = one or more place types, comma-separated ("cafe,bar")
  // lunch = 'yes' / 'no' / '' (unknown); lunch_from/lunch_to = "12:00"; lunch_menu = free text
  Places:  ['id', 'name', 'address', 'lat', 'lng', 'type', 'osm_id', 'created_by', 'created_at',
            'lunch', 'lunch_from', 'lunch_to', 'lunch_menu', 'lunch_photo_id', 'open_from', 'open_to',
            'promo', 'promo_by', 'promo_at'],  // promo = current promotions (free text), who and when last set it
  Dishes:  ['id', 'place_id', 'name', 'description', 'category', 'price', 'photo_id', 'created_by', 'created_at'],
  Reviews: ['id', 'dish_id', 'place_id', 'user_id', 'rating', 'comment', 'photo_id', 'created_at', 'updated_at'],
  // reviews of the establishment itself (one per user per place)
  PlaceReviews: ['id', 'place_id', 'user_id', 'rating', 'comment', 'photo_id', 'created_at', 'updated_at'],
  // personal "Want to try" lists (each user sees only their own)
  Wishlist:  ['id', 'user_id', 'dish_id', 'created_at'],
  // reactions on reviews: kind = 'heart' (useful) or 'clown'
  Reactions: ['id', 'review_id', 'user_id', 'kind', 'created_at'],
};
const REACTIONS = ['heart', 'clown'];
const BACKUP_KEEP = 7; // daily backups to keep

const PLACE_TYPES = ['cafe', 'restaurant', 'fast_food', 'bar', 'coffee', 'bakery', 'canteen', 'other'];
// Dish categories: the app shows them in two steps (group → subcategory); the Sheet stores the final key.
// Keep in sync with CAT_TREE in app/js/i18n.js.
const CATEGORIES = [
  'soups', 'salads', 'meat', 'fish', 'starters', 'pelmeni', 'pasta', 'other_main',   // Main
  'pizza', 'burgers', 'sushi', 'shawarma', 'other_fast',                            // Fast food
  'breakfast', 'business_lunch', 'bakery', 'desserts',                              // single categories
  'coffee', 'tea', 'soft_drinks', 'alcohol',                                        // Drinks
];
// Old keys from the first version → new keys (used by setup() to update existing dishes)
const LEGACY_CATEGORIES = { dumplings: 'pelmeni', asian: 'other_main', street_food: 'other_fast',
  drinks: 'soft_drinks', other: 'other_main' };

const LIMITS = { promo: 500, name: 80, placeName: 30, address: 30, description: 300, comment: 500, displayName: 40, lunchMenu: 600, photoBytes: 900000 }; // the app sends optimized JPEGs of ~150–450 KB

// ===== ENTRY POINTS =====
function doGet() {
  return json_({ ok: true, app: 'kotletka', time: new Date().toISOString() });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'bad_json' });
  }
  try {
    const handler = ACTIONS[req.action];
    if (!handler) throw new ApiError('unknown_action');
    const result = handler(req);
    return json_({ ok: true, data: result });
  } catch (err) {
    if (err instanceof ApiError) return json_({ ok: false, error: err.message });
    console.error(err && err.stack || err);
    return json_({ ok: false, error: 'server_error' });
  }
}

class ApiError extends Error {}

// ===== ACTIONS =====
const ACTIONS = {
  // Public: whole dataset (small city, small group — one request is fastest).
  // With a valid token it also returns the signed-in user's private "Want to try" list.
  getAll(req) {
    let me = null;
    if (req.token) { try { me = auth_(req); } catch (e) { /* expired token: public data only */ } }
    const users = readAll_('Users').map(u => ({ id: u.id, name: u.name, role: u.role, avatar_id: u.avatar_id || '' }));
    return {
      places: readAll_('Places').map(cleanPlace_),
      dishes: readAll_('Dishes').map(cleanDish_),
      reviews: readAll_('Reviews').map(cleanReview_),
      place_reviews: readAll_('PlaceReviews').map(cleanPlaceReview_),
      reactions: readAll_('Reactions').map(x => ({ review_id: x.review_id, user_id: x.user_id, kind: x.kind })),
      users,
      wishlist: me ? readAll_('Wishlist').filter(w => w.user_id === me.id).map(w => w.dish_id) : [],
      // only for the signed-in user: null = never checked yet (the app then records the current badges silently)
      badges_shown: me ? (me.badges_shown ? splitBadges_(me.badges_shown) : null) : undefined,
    };
  },

  // Sign in: verifies the Google token (or an app session), creates the user on first visit.
  // Returns a fresh app session, so the user stays signed in for SESSION_DAYS without Google's 1-hour token.
  me(req) {
    const user = auth_(req);
    const out = publicUser_(user);
    out.session = issueSession_(user.id);
    return out;
  },

  // {name} and/or {avatar: dataUrl} / {removeAvatar: true}
  updateProfile(req) {
    const me = auth_(req);
    return withLock_(() => {
      const user = findById_('Users', me.id) || me; // fresh row, so other columns are not overwritten
      if (req.name !== undefined) {
        const name = str_(req.name, LIMITS.displayName);
        if (!name) throw new ApiError('name_required');
        user.name = name;
      }
      if (req.removeAvatar || req.avatar) { trashFile_(user.avatar_id); user.avatar_id = ''; }
      if (req.avatar) user.avatar_id = savePhoto_(req.avatar, 'avatar_' + user.id);
      updateRow_('Users', user);
      return publicUser_(user);
    });
  },

  // Add/remove a dish in the user's "Want to try" list. {dish_id, on: true|false}
  wishToggle(req) {
    const user = auth_(req);
    return withLock_(() => {
      const dishId = String(req.dish_id || '');
      if (!findById_('Dishes', dishId)) throw new ApiError('dish_not_found');
      deleteWhere_('Wishlist', w => w.user_id === user.id && w.dish_id === dishId);
      if (req.on) {
        if (readAll_('Reviews').some(r => r.dish_id === dishId && r.user_id === user.id)) throw new ApiError('already_reviewed');
        appendRow_('Wishlist', { id: newId_(), user_id: user.id, dish_id: dishId, created_at: now_() });
      }
      return { dish_id: dishId, on: !!req.on };
    });
  },

  // React to someone else's review. ❤️ and 🤡 are independent: one person can put both on the same review.
  // {review_id, kind, on: true | false} sets the exact state of that kind (safe for quick taps).
  // Older apps send {set: 'heart' | 'clown' | ''} (one reaction per person) or only {kind} (toggle/switch).
  react(req) {
    const user = auth_(req);
    const kind = String(req.kind || '');
    const hasOn = typeof req.on === 'boolean';
    const hasSet = !hasOn && req.set !== undefined && req.set !== null;
    if (hasSet ? (req.set !== '' && !REACTIONS.includes(String(req.set))) : !REACTIONS.includes(kind)) throw new ApiError('bad_reaction');
    return withLock_(() => {
      const review = findById_('Reviews', req.review_id) || findById_('PlaceReviews', req.review_id);
      if (!review) throw new ApiError('not_found');
      if (review.user_id === user.id) throw new ApiError('own_review');
      const isMine = x => x.review_id === review.id && x.user_id === user.id;
      if (hasOn) {
        deleteWhere_('Reactions', x => isMine(x) && x.kind === kind);
        if (req.on) appendRow_('Reactions', { id: newId_(), review_id: review.id, user_id: user.id, kind, created_at: now_() });
        return { review_id: review.id, kind, on: req.on };
      }
      const mine = readAll_('Reactions').find(isMine);
      deleteWhere_('Reactions', isMine);
      const now = hasSet ? String(req.set) : (mine && mine.kind === kind ? '' : kind);
      if (now) appendRow_('Reactions', { id: newId_(), review_id: review.id, user_id: user.id, kind: now, created_at: now_() });
      return { review_id: review.id, kind: now };
    });
  },

  // Remember that these badges were celebrated, so no other device shows them again. {ids: [...]}
  markBadges(req) {
    const user = auth_(req);
    const ids = (Array.isArray(req.ids) ? req.ids : []).map(String).filter(x => /^[a-z0-9_]{1,40}$/.test(x)).slice(0, 100);
    return withLock_(() => {
      const fresh = findById_('Users', user.id) || user;
      const all = splitBadges_(fresh.badges_shown);
      ids.forEach(id => { if (!all.includes(id)) all.push(id); });
      fresh.badges_shown = all.length ? all.join(',') : '-';
      updateRow_('Users', fresh);
      return { badges_shown: all };
    });
  },

  // Opening hours — any signed-in user can keep them up to date. {id, open_from, open_to}
  updateHours(req) {
    auth_(req);
    return withLock_(() => {
      const place = findById_('Places', req.id);
      if (!place) throw new ApiError('not_found');
      place.open_from = time_(req.open_from);
      place.open_to = time_(req.open_to);
      updateRow_('Places', place);
      return cleanPlace_(place);
    });
  },

  addPlace(req) {
    const user = auth_(req);
    const p = req.place || {};
    const place = {
      id: newId_(),
      name: required_(str_(p.name, LIMITS.placeName), 'name_required'),
      address: str_(p.address, LIMITS.address),
      lat: num_(p.lat, 'bad_location'),
      lng: num_(p.lng, 'bad_location'),
      type: types_(p).join(','),
      osm_id: '',
      created_by: user.id,
      created_at: now_(),
    };
    Object.assign(place, lunch_(p));
    place.open_from = time_(p.open_from);
    place.open_to = time_(p.open_to);
    return withLock_(() => {
      const dup = readAll_('Places').find(x => sameName_(x.name, place.name) &&
        Math.abs(x.lat - place.lat) < 0.002 && Math.abs(x.lng - place.lng) < 0.003);
      if (dup) throw new ApiError('place_exists');
      appendRow_('Places', place);
      return cleanPlace_(place);
    });
  },

  // The author of the place or a moderator. Location and hours are changed only when sent.
  editPlace(req) {
    const user = auth_(req);
    const p = req.place || {};
    return withLock_(() => {
      const place = findById_('Places', p.id);
      if (!place) throw new ApiError('not_found');
      requireOwnerOrAdmin_(user, place);
      place.name = required_(str_(p.name, LIMITS.placeName), 'name_required');
      place.address = str_(p.address, LIMITS.address);
      place.type = types_(p).join(',');
      if ('lunch' in p) Object.assign(place, lunch_(p));
      if ('open_from' in p || 'open_to' in p) { place.open_from = time_(p.open_from); place.open_to = time_(p.open_to); }
      if (p.lat != null && p.lng != null) { place.lat = num_(p.lat, 'bad_location'); place.lng = num_(p.lng, 'bad_location'); }
      updateRow_('Places', place);
      return cleanPlace_(place);
    });
  },

  // Promotions — any signed-in user can keep them up to date. {id, promo} (empty = no promotions)
  updatePromo(req) {
    const user = auth_(req);
    return withLock_(() => {
      const place = findById_('Places', req.id);
      if (!place) throw new ApiError('not_found');
      place.promo = text_(req.promo, LIMITS.promo);
      place.promo_by = place.promo ? user.id : '';
      place.promo_at = place.promo ? now_() : '';
      updateRow_('Places', place);
      return cleanPlace_(place);
    });
  },

  // Business lunch info — any signed-in user can keep it up to date.
  updateLunch(req) {
    auth_(req);
    return withLock_(() => {
      const place = findById_('Places', req.id);
      if (!place) throw new ApiError('not_found');
      Object.assign(place, lunch_(req));
      // menu photo: kept while there is a lunch; replaced or removed on request
      if (place.lunch !== 'yes' || req.removeLunchPhoto || req.lunch_photo) {
        trashFile_(place.lunch_photo_id);
        place.lunch_photo_id = '';
      }
      if (place.lunch === 'yes' && req.lunch_photo) place.lunch_photo_id = savePhoto_(req.lunch_photo, 'lunch_' + place.id);
      updateRow_('Places', place);
      return cleanPlace_(place);
    });
  },

  // Any signed-in user can add a photo to a dish that has none; only the moderator can replace or remove one.
  setDishPhoto(req) {
    const user = auth_(req);
    return withLock_(() => {
      const dish = findById_('Dishes', req.id);
      if (!dish) throw new ApiError('not_found');
      if (dish.photo_id && user.role !== 'admin') throw new ApiError('forbidden');
      if (req.remove || req.photo) { trashPhoto_(dish); dish.photo_id = ''; }
      if (req.photo) dish.photo_id = savePhoto_(req.photo, 'dish_' + dish.id);
      updateRow_('Dishes', dish);
      return cleanDish_(dish);
    });
  },

  deletePlace(req) {
    requireAdmin_(auth_(req));
    return withLock_(() => {
      const id = String(req.id);
      const dishIds = {};
      readAll_('Dishes').forEach(d => { if (d.place_id === id) dishIds[d.id] = true; });
      deleteReviews_(r => r.place_id === id);
      deleteReviews_(r => r.place_id === id, 'PlaceReviews');
      deleteWhere_('Wishlist', w => dishIds[w.dish_id]);
      deleteWhere_('Dishes', d => d.place_id === id, trashPhoto_);
      deleteWhere_('Places', p => p.id === id, p => trashFile_(p.lunch_photo_id));
      return { id };
    });
  },

  addDish(req) {
    const user = auth_(req);
    const d = req.dish || {};
    return withLock_(() => {
      if (!findById_('Places', d.place_id)) throw new ApiError('place_not_found');
      const name = required_(str_(d.name, LIMITS.name), 'name_required');
      const dup = readAll_('Dishes').find(x => x.place_id === String(d.place_id) && sameName_(x.name, name));
      if (dup) throw new ApiError('dish_exists');
      const dish = {
        id: newId_(),
        place_id: String(d.place_id),
        name,
        description: str_(d.description, LIMITS.description),
        category: category_(d.category),
        price: price_(d.price),
        photo_id: '',
        created_by: user.id,
        created_at: now_(),
      };
      if (d.photo) dish.photo_id = savePhoto_(d.photo, 'dish_' + dish.id);
      appendRow_('Dishes', dish);
      return cleanDish_(dish);
    });
  },

  // The author of the dish or a moderator.
  editDish(req) {
    const user = auth_(req);
    const d = req.dish || {};
    return withLock_(() => {
      const dish = findById_('Dishes', d.id);
      if (!dish) throw new ApiError('not_found');
      requireOwnerOrAdmin_(user, dish);
      dish.name = required_(str_(d.name, LIMITS.name), 'name_required');
      dish.description = str_(d.description, LIMITS.description);
      dish.category = category_(d.category);
      dish.price = price_(d.price);
      if (d.removePhoto) { trashPhoto_(dish); dish.photo_id = ''; }
      if (d.photo) { trashPhoto_(dish); dish.photo_id = savePhoto_(d.photo, 'dish_' + dish.id); }
      updateRow_('Dishes', dish);
      return cleanDish_(dish);
    });
  },

  deleteDish(req) {
    requireAdmin_(auth_(req));
    return withLock_(() => {
      const id = String(req.id);
      deleteReviews_(r => r.dish_id === id);
      deleteWhere_('Wishlist', w => w.dish_id === id);
      deleteWhere_('Dishes', d => d.id === id, trashPhoto_);
      return { id };
    });
  },

  // Create or update the user's review of a dish (one review per user per dish).
  saveReview(req) {
    const user = auth_(req);
    const r = req.review || {};
    const rating = Math.round(Number(r.rating));
    if (!(rating >= 0 && rating <= 10)) throw new ApiError('bad_rating');
    const comment = text_(r.comment, LIMITS.comment);
    return withLock_(() => {
      const dish = findById_('Dishes', r.dish_id);
      if (!dish) throw new ApiError('dish_not_found');
      let review = readAll_('Reviews').find(x => x.dish_id === dish.id && x.user_id === user.id);
      const isNew = !review;
      if (isNew) {
        review = { id: newId_(), dish_id: dish.id, place_id: dish.place_id, user_id: user.id,
          rating, comment, photo_id: '', created_at: now_(), updated_at: now_() };
      } else {
        review.rating = rating;
        review.comment = comment;
        review.updated_at = now_();
      }
      if (r.removePhoto) { trashPhoto_(review); review.photo_id = ''; }
      if (r.photo) { trashPhoto_(review); review.photo_id = savePhoto_(r.photo, 'review_' + review.id); }
      if (isNew) appendRow_('Reviews', review); else updateRow_('Reviews', review);
      // tried it → it leaves the "Want to try" list
      deleteWhere_('Wishlist', w => w.user_id === user.id && w.dish_id === dish.id);
      return cleanReview_(review);
    });
  },

  // Create or update the user's review of an establishment (one per user per place).
  savePlaceReview(req) {
    const user = auth_(req);
    const r = req.review || {};
    const rating = Math.round(Number(r.rating));
    if (!(rating >= 0 && rating <= 10)) throw new ApiError('bad_rating');
    const comment = text_(r.comment, LIMITS.comment);
    return withLock_(() => {
      const place = findById_('Places', r.place_id);
      if (!place) throw new ApiError('place_not_found');
      let review = readAll_('PlaceReviews').find(x => x.place_id === place.id && x.user_id === user.id);
      const isNew = !review;
      if (isNew) {
        review = { id: newId_(), place_id: place.id, user_id: user.id, rating, comment, photo_id: '', created_at: now_(), updated_at: now_() };
      } else {
        review.rating = rating;
        review.comment = comment;
        review.updated_at = now_();
      }
      if (r.removePhoto) { trashPhoto_(review); review.photo_id = ''; }
      if (r.photo) { trashPhoto_(review); review.photo_id = savePhoto_(r.photo, 'preview_' + review.id); }
      if (isNew) appendRow_('PlaceReviews', review); else updateRow_('PlaceReviews', review);
      return cleanPlaceReview_(review);
    });
  },

  deletePlaceReview(req) {
    const user = auth_(req);
    return withLock_(() => {
      const review = findById_('PlaceReviews', req.id);
      if (!review) throw new ApiError('not_found');
      if (review.user_id !== user.id && user.role !== 'admin') throw new ApiError('forbidden');
      deleteReviews_(r => r.id === review.id, 'PlaceReviews');
      return { id: review.id };
    });
  },

  deleteReview(req) {
    const user = auth_(req);
    return withLock_(() => {
      const review = findById_('Reviews', req.id);
      if (!review) throw new ApiError('not_found');
      if (review.user_id !== user.id && user.role !== 'admin') throw new ApiError('forbidden');
      deleteReviews_(r => r.id === review.id);
      return { id: review.id };
    });
  },
};

// ===== AUTH =====
// The app signs in with a Google ID token once (valid ~1 hour), then calls `me` and gets an app session
// token (valid SESSION_DAYS, renewed by the app while it is used). Both kinds are accepted everywhere.
const SESSION_DAYS = 60;

function auth_(req) {
  if (!req.token) throw new ApiError('auth_required');
  if (String(req.token).indexOf(SESSION_PREFIX) === 0) {
    const uid = verifySession_(req.token);
    const user = readAll_('Users').find(u => u.id === uid);
    if (!user) throw new ApiError('bad_token');
    if (user.role === 'banned') throw new ApiError('banned');
    return user;
  }
  const info = verifyGoogleToken_(req.token);
  const users = readAll_('Users');
  const uid = 'g' + info.sub; // prefix keeps long numeric ids as text in Sheets
  let user = users.find(u => u.id === uid);
  if (!user) {
    return withLock_(() => {
      const again = readAll_('Users').find(u => u.id === uid);
      if (again) return again;
      const adminEmail = PropertiesService.getScriptProperties().getProperty('ADMIN_EMAIL') || '';
      const created = {
        id: uid,
        email: info.email || '',
        name: str_(info.name || (info.email || 'User').split('@')[0], LIMITS.displayName),
        role: adminEmail && info.email && adminEmail.toLowerCase() === info.email.toLowerCase() ? 'admin' : 'user',
        created_at: now_(),
      };
      appendRow_('Users', created);
      return created;
    });
  }
  if (user.role === 'banned') throw new ApiError('banned');
  return user;
}

function verifyGoogleToken_(token) {
  const cache = CacheService.getScriptCache();
  const key = 'tok_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token)).slice(0, 40);
  const cached = cache.get(key);
  if (cached) return JSON.parse(cached);

  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token),
    { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new ApiError('bad_token');
  const info = JSON.parse(res.getContentText());
  const issOk = info.iss === 'accounts.google.com' || info.iss === 'https://accounts.google.com';
  if (info.aud !== GOOGLE_CLIENT_ID || !issOk) throw new ApiError('bad_token');
  const secondsLeft = Number(info.exp) - Math.floor(Date.now() / 1000);
  if (secondsLeft <= 0) throw new ApiError('token_expired');
  const out = { sub: info.sub, email: info.email, name: info.name };
  cache.put(key, JSON.stringify(out), Math.min(secondsLeft, 3000));
  return out;
}

// Session token: "ks1.<payload>.<signature>", payload = base64url JSON {uid, exp (seconds)}.
// Signed with SESSION_SECRET (a Script property created on first use; never in the code).
// To sign everybody out: delete SESSION_SECRET in Project Settings → Script properties.
const SESSION_PREFIX = 'ks1.';

function sessionSecret_() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('SESSION_SECRET');
  if (!secret) { // first use (setup() also creates it)
    secret = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('SESSION_SECRET', secret);
  }
  return secret;
}

function signSession_(payload) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(payload, sessionSecret_())).replace(/=+$/, '');
}

function issueSession_(uid) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const payload = Utilities.base64EncodeWebSafe(JSON.stringify({ uid, exp })).replace(/=+$/, '');
  return SESSION_PREFIX + payload + '.' + signSession_(payload);
}

function verifySession_(token) {
  const parts = String(token).slice(SESSION_PREFIX.length).split('.');
  if (parts.length !== 2 || signSession_(parts[0]) !== parts[1]) throw new ApiError('bad_token');
  let data;
  try {
    let b64 = parts[0];
    while (b64.length % 4) b64 += '=';
    data = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(b64)).getDataAsString());
  } catch (e) { throw new ApiError('bad_token'); }
  if (!data.uid || !(Number(data.exp) * 1000 > Date.now())) throw new ApiError('token_expired');
  return String(data.uid);
}

function requireAdmin_(user) {
  if (user.role !== 'admin') throw new ApiError('forbidden');
}

function requireOwnerOrAdmin_(user, row) {
  if (user.role !== 'admin' && String(row.created_by) !== user.id) throw new ApiError('forbidden');
}

function publicUser_(u) {
  return { id: u.id, name: u.name, role: u.role, email: u.email, avatar_id: u.avatar_id || '' };
}

function splitBadges_(v) {
  return String(v || '').split(',').map(x => x.trim()).filter(x => x && x !== '-');
}

// Deletes reviews (dish reviews, or establishment reviews with tab = 'PlaceReviews') with their photos and reactions
function deleteReviews_(predicate, tab) {
  tab = tab || 'Reviews';
  const ids = {};
  readAll_(tab).forEach(r => { if (predicate(r)) ids[r.id] = true; });
  if (!Object.keys(ids).length) return;
  deleteWhere_('Reactions', x => ids[x.review_id]);
  deleteWhere_(tab, r => ids[r.id], trashPhoto_);
}

// ===== PHOTOS (Google Drive) =====
function photoFolder_() {
  const id = PropertiesService.getScriptProperties().getProperty('PHOTO_FOLDER_ID');
  if (!id) throw new ApiError('photos_not_configured');
  return DriveApp.getFolderById(id);
}

// photo = "data:image/jpeg;base64,...." (the app resizes images before upload)
function savePhoto_(dataUrl, name) {
  const m = /^data:(image\/(jpeg|png|webp));base64,(.+)$/.exec(String(dataUrl));
  if (!m) throw new ApiError('bad_photo');
  const bytes = Utilities.base64Decode(m[3]);
  if (bytes.length > LIMITS.photoBytes) throw new ApiError('photo_too_large');
  const file = photoFolder_().createFile(Utilities.newBlob(bytes, m[1], name + '.' + m[2]));
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getId();
}

function trashPhoto_(row) {
  if (row) trashFile_(row.photo_id);
}
function trashFile_(id) {
  if (!id) return;
  try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { /* already gone */ }
}

// ===== SHEET HELPERS =====
function sheet_(name) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (!sh && SCHEMA[name] && ss.getSheetByName('Users')) {
    // a tab added in a newer version: create it on first use, like setup() does
    try { sh = ss.insertSheet(name); } catch (e) { return ss.getSheetByName(name); } // another request just made it
    sh.getRange(1, 1, 1, SCHEMA[name].length).setValues([SCHEMA[name]]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), SCHEMA[name].length).setNumberFormat('@');
  }
  if (!sh) throw new ApiError('run_setup_first');
  if (SCHEMA[name] && !HEADER_OK_[name]) {
    // columns added in a newer version: write the full header row once
    if (sh.getLastColumn() < SCHEMA[name].length) {
      sh.getRange(1, 1, 1, SCHEMA[name].length).setValues([SCHEMA[name]]).setFontWeight('bold');
    }
    HEADER_OK_[name] = true;
  }
  return sh;
}
const HEADER_OK_ = {};

// Rows already read in this request (Apps Script starts every request fresh). Cleared on every write to that tab
// and when a lock is taken, so code under the lock always sees the latest data.
let MEMO_ = {};
function readAll_(name) {
  if (!MEMO_[name]) MEMO_[name] = readSheet_(name);
  return MEMO_[name].map(o => Object.assign({}, o)); // copies: callers change rows before saving them
}

function readSheet_(name) {
  const sh = sheet_(name);
  const cols = SCHEMA[name];
  const last = sh.getLastRow();
  if (last < 2) return [];
  const values = sh.getRange(2, 1, last - 1, cols.length).getValues();
  const out = [];
  for (let i = 0; i < values.length; i++) {
    if (values[i][0] === '') continue;
    const o = { _row: i + 2 };
    cols.forEach((c, j) => { o[c] = cell_(values[i][j]); });
    o.id = String(o.id);
    ['place_id', 'dish_id', 'user_id', 'created_by'].forEach(k => { if (k in o) o[k] = String(o[k]); });
    out.push(o);
  }
  return out;
}

// Sheets turns "10:00" typed into a non-text column into a time (a Date on 30 Dec 1899): read it back as "10:00".
let sheetTz_ = null;
function cell_(v) {
  if (!(v instanceof Date)) return v;
  if (v.getFullYear() < 1901) {
    sheetTz_ = sheetTz_ || SpreadsheetApp.getActive().getSpreadsheetTimeZone();
    return Utilities.formatDate(v, sheetTz_, 'HH:mm');
  }
  return v.toISOString();
}

function findById_(name, id) {
  id = String(id || '');
  return id ? readAll_(name).find(x => x.id === id) : null;
}

// Times like "10:00" are written with a leading apostrophe so Sheets keeps them as text.
function toRow_(name, obj) {
  return SCHEMA[name].map(c => {
    const v = obj[c];
    if (v === undefined || v === null) return '';
    return typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v) ? "'" + v : v;
  });
}

function appendRow_(name, obj) {
  delete MEMO_[name];
  sheet_(name).appendRow(toRow_(name, obj));
}

function updateRow_(name, obj) {
  const row = obj._row || (findById_(name, obj.id) || {})._row;
  if (!row) throw new ApiError('not_found');
  delete MEMO_[name];
  sheet_(name).getRange(row, 1, 1, SCHEMA[name].length).setValues([toRow_(name, obj)]);
}

function deleteWhere_(name, predicate, onDelete) {
  const sh = sheet_(name);
  const rows = readAll_(name).filter(predicate);
  if (rows.length) delete MEMO_[name];
  rows.sort((a, b) => b._row - a._row).forEach(r => {
    if (onDelete) onDelete(r);
    sh.deleteRow(r._row);
  });
  return rows.length;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new ApiError('busy_try_again');
  MEMO_ = {};
  // flush() before unlocking: otherwise the next request may not see rows written here yet
  // (this is how one user got two rows in Users).
  try { return fn(); } finally { SpreadsheetApp.flush(); lock.releaseLock(); }
}

// ===== CLEANERS (what the app is allowed to see — no emails) =====
function cleanPlace_(p) {
  return { id: p.id, name: p.name, address: p.address, lat: Number(p.lat), lng: Number(p.lng),
    types: splitTypes_(p.type), created_by: p.created_by, created_at: p.created_at,
    lunch: p.lunch || '', lunch_from: p.lunch_from || '', lunch_to: p.lunch_to || '', lunch_menu: p.lunch_menu || '',
    lunch_photo_id: p.lunch_photo_id || '', open_from: p.open_from || '', open_to: p.open_to || '',
    promo: p.promo || '', promo_by: p.promo_by || '', promo_at: p.promo_at || '' };
}
function cleanDish_(d) {
  return { id: d.id, place_id: d.place_id, name: d.name, description: d.description, category: category_(d.category),
    price: d.price === '' ? null : Number(d.price), photo_id: d.photo_id, created_by: d.created_by, created_at: d.created_at };
}
function cleanPlaceReview_(r) {
  return { id: r.id, place_id: r.place_id, user_id: r.user_id, rating: Number(r.rating),
    comment: r.comment, photo_id: r.photo_id, created_at: r.created_at, updated_at: r.updated_at };
}
function cleanReview_(r) {
  return { id: r.id, dish_id: r.dish_id, place_id: r.place_id, user_id: r.user_id, rating: Number(r.rating),
    comment: r.comment, photo_id: r.photo_id, created_at: r.created_at, updated_at: r.updated_at };
}

// ===== SMALL UTILS =====
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
// Always starts with a letter so Sheets never turns an id into a number
function newId_() { return 'i' + Utilities.getUuid().replace(/-/g, '').slice(0, 11); }
function now_() { return new Date().toISOString(); }
function str_(v, max) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max); }
// Multi-line text: keeps line breaks, but several in a row (empty lines) become one.
function text_(v, max) {
  return String(v == null ? '' : v).replace(/\r/g, '').split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean).join('\n').slice(0, max);
}
function required_(v, err) { if (!v) throw new ApiError(err); return v; }
function num_(v, err) { const n = Number(v); if (!isFinite(n)) throw new ApiError(err || 'bad_number'); return n; }
function price_(v) {
  if (v === '' || v == null) return '';
  const n = Math.round(Number(v));
  if (!(n >= 0 && n < 1000000)) throw new ApiError('bad_price');
  return n;
}
function splitTypes_(v) {
  const list = String(v || '').split(',').map(x => x.trim()).filter(x => PLACE_TYPES.includes(x));
  return list.length ? list : ['other'];
}
// accepts {types: ['cafe','bar']} or {type: 'cafe,bar'}
function types_(p) {
  const raw = Array.isArray(p.types) ? p.types.join(',') : (p.type || '');
  return splitTypes_(raw).filter((x, i, a) => a.indexOf(x) === i);
}
function category_(c) {
  c = LEGACY_CATEGORIES[c] || c;
  return CATEGORIES.includes(c) ? c : 'other_main';
}
function time_(v) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || '').trim());
  if (!m) return '';
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return '';
  return (h < 10 ? '0' : '') + h + ':' + m[2];
}
function lunch_(p) {
  const lunch = p.lunch === 'yes' || p.lunch === 'no' ? p.lunch : '';
  if (lunch !== 'yes') return { lunch, lunch_from: '', lunch_to: '', lunch_menu: '' };
  return { lunch, lunch_from: time_(p.lunch_from), lunch_to: time_(p.lunch_to),
    lunch_menu: String(p.lunch_menu || '').replace(/\r/g, '').trim().slice(0, LIMITS.lunchMenu) };
}
function sameName_(a, b) {
  const norm = s => String(s).toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, '');
  return norm(a) === norm(b);
}

// ===== ONE-TIME SETUP (run from the Apps Script editor) =====
function setup() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(SCHEMA).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, SCHEMA[name].length).setValues([SCHEMA[name]]).setFontWeight('bold');
    sh.setFrozenRows(1);
    // keep everything as plain text (no auto-conversion of ids/dates); app converts numbers
    sh.getRange(1, 1, sh.getMaxRows(), SCHEMA[name].length).setNumberFormat('@');
  });
  const def = ss.getSheetByName('Sheet1') || ss.getSheetByName('Лист1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);

  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('PHOTO_FOLDER_ID')) {
    const folder = DriveApp.createFolder('Kotletka — photos');
    props.setProperty('PHOTO_FOLDER_ID', folder.getId());
  }
  // Update dishes saved with old category keys
  const dishes = readAll_('Dishes').filter(d => d.category && d.category !== category_(d.category));
  dishes.forEach(d => { d.category = category_(d.category); updateRow_('Dishes', d); });
  if (dishes.length) console.log('Updated categories of ' + dishes.length + ' dishes.');

  sessionSecret_();
  const me = Session.getEffectiveUser().getEmail();
  props.setProperty('ADMIN_EMAIL', me);
  console.log('Setup done. Admin: ' + me);
}

// Public Overpass servers (OpenStreetMap data). They are free and often overloaded,
// and some refuse Google's servers, so we try them one by one.
const OVERPASS_URLS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.osm.jp/api/interpreter',
];

function fetchOverpass_(query) {
  const problems = [];
  for (const url of OVERPASS_URLS) {
    try {
      const res = UrlFetchApp.fetch(url, { method: 'post', payload: { data: query }, muteHttpExceptions: true });
      const code = res.getResponseCode();
      const text = res.getContentText();
      if (code === 200 && text.trim().charAt(0) === '{') {
        console.log('Got data from ' + url);
        return JSON.parse(text).elements || [];
      }
      problems.push(url + ' → HTTP ' + code);
    } catch (e) {
      problems.push(url + ' → ' + e.message);
    }
  }
  throw new Error('All Overpass servers failed. Try again in a few minutes, or use tools/import_places.py.\n' +
    problems.join('\n'));
}

// Load cafes, restaurants etc. of Krasnoyarsk from OpenStreetMap. Safe to re-run: skips ones already imported.
function importPlacesFromOSM() {
  const b = CITY_BBOX.join(',');
  const q = '[out:json][timeout:90];(' +
    'nwr["amenity"~"^(cafe|restaurant|fast_food|bar|pub|food_court)$"]["name"](' + b + ');' +
    'nwr["shop"="bakery"]["name"](' + b + ');' +
    ');out center tags;';
  const elements = fetchOverpass_(q);

  const typeMap = { cafe: 'cafe', restaurant: 'restaurant', fast_food: 'fast_food', bar: 'bar', pub: 'bar', food_court: 'canteen' };
  const existing = {};
  readAll_('Places').forEach(p => { if (p.osm_id) existing[p.osm_id] = true; });

  const rows = [];
  elements.forEach(el => {
    const t = el.tags || {};
    const osmId = el.type + '/' + el.id;
    if (existing[osmId]) return;
    const lat = el.lat != null ? el.lat : (el.center && el.center.lat);
    const lng = el.lon != null ? el.lon : (el.center && el.center.lon);
    if (lat == null || lng == null) return;
    let type = t.shop === 'bakery' ? 'bakery' : (typeMap[t.amenity] || 'other');
    if (type === 'cafe' && /coffee/.test(t.cuisine || '')) type = 'coffee';
    if (/столовая/i.test(t.name)) type = 'canteen';
    const address = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(', ');
    rows.push(toRow_('Places', {
      id: newId_(), name: str_(t.name, LIMITS.placeName), address: str_(address, LIMITS.address),
      lat, lng, type, osm_id: osmId, created_by: 'osm', created_at: now_(),
    }));
  });
  if (rows.length) {
    const sh = sheet_('Places');
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, SCHEMA.Places.length).setValues(rows);
  }
  console.log('Imported ' + rows.length + ' places (' + elements.length + ' found in OSM).');
}

// ===== DUPLICATE USERS CLEANUP (run once from the editor) =====
// Older versions could create two rows for one user when the app sent two requests at once.
// Keeps the first row of each id, fills its empty cells from the copies, deletes the copies.
function dedupeUsers() {
  withLock_(() => {
    const users = readAll_('Users');
    const first = {};
    const extra = [];
    users.forEach(u => {
      const keep = first[u.id];
      if (!keep) { first[u.id] = u; return; }
      SCHEMA.Users.forEach(c => {
        if ((keep[c] === '' || keep[c] == null) && u[c] !== '' && u[c] != null) { keep[c] = u[c]; keep._changed = true; }
      });
      extra.push(u);
    });
    Object.keys(first).forEach(id => { if (first[id]._changed) updateRow_('Users', first[id]); });
    const sh = sheet_('Users');
    extra.sort((a, b) => b._row - a._row).forEach(u => sh.deleteRow(u._row));
    console.log('Removed ' + extra.length + ' duplicate user rows.');
  });
}

// ===== ONE-TIME CLEANUP =====
// Keeps only places, dishes and reviews created by moderators (role = admin in the Users tab)
// and deletes everything else (e.g. places imported from OpenStreetMap, test data).
// 1) Run cleanupPreview — it only shows what would be deleted.
// 2) If it looks right, run cleanupKeepOnlyMine.
function cleanupPreview() { cleanup_(false); }
function cleanupKeepOnlyMine() { cleanup_(true); }

function cleanup_(apply) {
  const admins = {};
  readAll_('Users').forEach(u => { if (u.role === 'admin') admins[u.id] = u.name || u.email; });
  if (!Object.keys(admins).length) throw new Error('No admin in the Users tab. Sign in to the app once, then run this again.');

  const places = readAll_('Places');
  const keepPlaces = {};
  places.forEach(p => { if (admins[p.created_by]) keepPlaces[p.id] = true; });
  const dishes = readAll_('Dishes');
  const keepDishes = {};
  dishes.forEach(d => { if (keepPlaces[d.place_id] && admins[d.created_by]) keepDishes[d.id] = true; });
  const reviews = readAll_('Reviews');
  const keepReview = r => keepDishes[r.dish_id] && admins[r.user_id];

  const plan = {
    Places: places.filter(p => keepPlaces[p.id]),
    Dishes: dishes.filter(d => keepDishes[d.id]),
    Reviews: reviews.filter(keepReview),
  };
  const keptReviewIds = {};
  plan.Reviews.forEach(r => { keptReviewIds[r.id] = true; });
  const placeReviews = readAll_('PlaceReviews');
  plan.PlaceReviews = placeReviews.filter(r => keepPlaces[r.place_id] && admins[r.user_id]);
  plan.PlaceReviews.forEach(r => { keptReviewIds[r.id] = true; });
  plan.Reactions = readAll_('Reactions').filter(x => keptReviewIds[x.review_id]);
  plan.Wishlist = readAll_('Wishlist').filter(w => keepDishes[w.dish_id]);
  console.log('Moderators: ' + Object.values(admins).join(', '));
  console.log('Places:  keep ' + plan.Places.length + ', delete ' + (places.length - plan.Places.length));
  plan.Places.forEach(p => console.log('   keep place: ' + p.name));
  console.log('Dishes:  keep ' + plan.Dishes.length + ', delete ' + (dishes.length - plan.Dishes.length));
  plan.Dishes.forEach(d => console.log('   keep dish: ' + d.name));
  console.log('Reviews: keep ' + plan.Reviews.length + ', delete ' + (reviews.length - plan.Reviews.length));
  if (!apply) { console.log('Preview only — nothing changed. Run cleanupKeepOnlyMine to apply.'); return; }

  withLock_(() => {
    places.filter(p => !keepPlaces[p.id]).forEach(p => trashFile_(p.lunch_photo_id));
    dishes.filter(d => !keepDishes[d.id]).forEach(trashPhoto_);
    reviews.filter(r => !keepReview(r)).forEach(trashPhoto_);
    placeReviews.filter(r => !(keepPlaces[r.place_id] && admins[r.user_id])).forEach(trashPhoto_);
    Object.keys(plan).forEach(name => rewriteSheet_(name, plan[name]));
  });
  console.log('Done. Users tab was not changed.');
}

// Replace all data rows of a tab at once (fast even for thousands of rows).
function rewriteSheet_(name, rows) {
  delete MEMO_[name];
  const sh = sheet_(name);
  const width = SCHEMA[name].length;
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, width).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, width).setValues(rows.map(r => toRow_(name, r)));
}

// ===== PHOTO STORAGE TOOLS (run from the editor) =====
// Shows how many photos there are and how much space they take.
function photoStorageReport() {
  const it = photoFolder_().getFiles();
  let count = 0, bytes = 0;
  while (it.hasNext()) { const f = it.next(); count++; bytes += f.getSize(); }
  console.log(count + ' photos, ' + (bytes / 1048576).toFixed(1) + ' MB' +
    (count ? ', average ' + Math.round(bytes / count / 1024) + ' KB' : '') + '. Free Google account: 15 GB in total.');
}

// Moves to Trash photos that nothing in the Sheet points to any more (e.g. after editing rows by hand).
// Drive empties its Trash automatically after 30 days.
function deleteUnusedPhotos() {
  const used = {};
  readAll_('Dishes').forEach(d => { if (d.photo_id) used[d.photo_id] = true; });
  readAll_('Reviews').forEach(r => { if (r.photo_id) used[r.photo_id] = true; });
  readAll_('PlaceReviews').forEach(r => { if (r.photo_id) used[r.photo_id] = true; });
  readAll_('Places').forEach(p => { if (p.lunch_photo_id) used[p.lunch_photo_id] = true; });
  readAll_('Users').forEach(u => { if (u.avatar_id) used[u.avatar_id] = true; });
  const it = photoFolder_().getFiles();
  let removed = 0, bytes = 0;
  while (it.hasNext()) {
    const f = it.next();
    if (!used[f.getId()]) { bytes += f.getSize(); f.setTrashed(true); removed++; }
  }
  console.log('Moved ' + removed + ' unused photos (' + (bytes / 1048576).toFixed(1) + ' MB) to Trash.');
}

// ===== BACKUPS =====
// A copy of the whole Sheet is saved to the Drive folder "Kotletka — backups"; only the last BACKUP_KEEP copies are kept.
// Run setupDailyBackup once: it schedules backupNow every night (~3:00) and makes the first copy right away.
function backupNow() {
  const props = PropertiesService.getScriptProperties();
  let folder;
  try { folder = DriveApp.getFolderById(props.getProperty('BACKUP_FOLDER_ID')); } catch (e) { folder = null; }
  if (!folder) {
    folder = DriveApp.createFolder('Kotletka — backups');
    props.setProperty('BACKUP_FOLDER_ID', folder.getId());
  }
  const ss = SpreadsheetApp.getActive();
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH-mm');
  DriveApp.getFileById(ss.getId()).makeCopy('Kotletka backup ' + stamp, folder);

  const copies = [];
  const it = folder.getFiles();
  while (it.hasNext()) copies.push(it.next());
  copies.sort((a, b) => b.getDateCreated() - a.getDateCreated());
  copies.slice(BACKUP_KEEP).forEach(f => f.setTrashed(true));
  console.log('Backup "' + stamp + '" saved. Keeping ' + Math.min(copies.length, BACKUP_KEEP) + ' copies.');
}

function setupDailyBackup() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'backupNow')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('backupNow').timeBased().everyDays(1).atHour(3).create();
  console.log('Daily backup scheduled for about 3:00 (' + Session.getScriptTimeZone() + ').');
  backupNow();
}

// To restore: open the backup copy in Drive, copy the tabs' data back into the main Sheet
// (or rename the copy and attach this script to it). Photos are not part of the copy — they stay in the photo folder.

