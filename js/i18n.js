// Translations. To add a word: add the key to both `en` and `ru`.
(function () {
  const en = {
    tab_map: 'Map', tab_places: 'Establishments', tab_top: 'Top', tab_profile: 'Profile',
    not_configured: 'Not configured: set API_URL and GOOGLE_CLIENT_ID in js/config.js',
    loading: 'Loading…', loading_data: 'Loading data…', offline_cached: 'Offline — showing saved data', refresh: 'Refresh',
    search_places: 'Search establishments…', search_dishes: 'Search dishes…',
    all: 'All', only_reviewed: 'With reviews', show_more: 'Show more',
    no_places: 'No establishments found', no_dishes: 'No dishes yet — add the first one!',
    no_reviews: 'No reviews yet — be the first!', nothing_here: 'Nothing here yet',
    reviews_n: n => n === 1 ? '1 review' : `${n} reviews`,
    dishes_n: n => n === 1 ? '1 dish' : `${n} dishes`,
    places_n: n => n === 1 ? '1 place' : `${n} places`,
    open: 'Open', add_place: 'Add establishment', add_dish: 'Add dish',
    pick_location: 'Move the map so the pin points at the establishment', confirm: 'Confirm', cancel: 'Cancel',
    save: 'Save', delete: 'Delete', edit: 'Edit', close: 'Close', back: 'Back',
    name: 'Name', address: 'Address', type: 'Type', description: 'Short description', category: 'Category',
    price: 'Price', optional: 'optional', photo: 'Photo', add_photo: 'Add photo', remove_photo: 'Remove photo',
    top_dishes: 'Top dishes', top_here: 'Top dishes here', latest_reviews: 'Latest reviews',
    top_hint: 'Ranked by rating; dishes with more reviews weigh more.',
    your_rating: 'Your rating', comment: 'Comment', comment_ph: 'What was good or bad?',
    write_review: 'Write a review', edit_review: 'Edit my review', you: 'You', edited: 'edited',
    sign_in: 'Sign in with Google', sign_out: 'Sign out',
    sign_in_needed: 'Sign in to add establishments, dishes and reviews.',
    sign_in_trouble: 'Sign-in stuck? Try another way', sign_in_failed: 'Sign-in failed, please try again',
    display_name: 'Display name', change_name: 'Change name', my_reviews: 'My reviews',
    language: 'Language', admin: 'Moderator', install_hint: 'Tip: use “Add to Home Screen” in your browser menu to install the app.',
    confirm_delete_review: 'Delete this review?', confirm_delete_dish: 'Delete this dish and all its reviews?',
    confirm_delete_place: 'Delete this establishment with all dishes and reviews?',
    saved: 'Saved', deleted: 'Deleted', error: 'Something went wrong',
    at_place: 'at', by: 'by', map_attr: 'Map',
    types: { cafe: 'Cafe', restaurant: 'Restaurant', fast_food: 'Fast food', bar: 'Bar / pub', coffee: 'Coffee shop',
      bakery: 'Bakery', canteen: 'Canteen', other: 'Other' },
    cats: { soups: 'Soups', salads: 'Salads', meat: 'Meat', fish: 'Fish', starters: 'Snacks', pelmeni: 'Pelmeni',
      pasta: 'Pasta', other_main: 'Other main', pizza: 'Pizza', burgers: 'Burgers', sushi: 'Sushi', shawarma: 'Shaurma',
      other_fast: 'Other fast food', breakfast: 'Breakfast', business_lunch: 'Business lunch', bakery: 'Bakery',
      desserts: 'Desserts', coffee: 'Coffee', tea: 'Tea', soft_drinks: 'Non-alcoholic', alcohol: 'Alcohol' },
    groups: { main: 'Main', fast_food: 'Fast food', breakfast: 'Breakfast', business_lunch: 'Business lunch',
      bakery: 'Bakery', desserts: 'Desserts', starters: 'Snacks', drinks: 'Drinks' },
    subcategory: 'Subcategory', types_pick: 'Type (choose one or more)', pick_one_type: 'Choose at least one type',
    lunch: 'Business lunch', lunch_q: 'Is there a business lunch?', yes: 'Yes', no: 'No', unknown: 'Unknown',
    lunch_from: 'From', lunch_to: 'To', lunch_menu: 'Lunch menu', lunch_menu_ph: 'e.g. Soup + main + drink — 350 ₽',
    lunch_none: 'No business lunch', lunch_unknown: 'No info yet', lunch_add: 'Add info', lunch_dishes: 'Business lunch dishes',
    has_lunch: 'Business lunch',
    lunch_menu_photo: 'Menu photo', add_menu_photo: 'Add menu photo', add_dish_photo: 'Add dish photo',
    pick_photo: 'Choose a photo first', bad_image: 'Could not read this image', optimizing: 'Optimizing photo…',
    optimized: ([a, b]) => `Optimized: ${a} → ${b}`,
    want_to_try: 'Want to try', in_wishlist: 'In my list', wishlist: 'Want to try', rate_it: 'Rate',
    wishlist_empty: 'Nothing here yet. Tap 🔖 on a dish or a friend’s review to save it for later.',
    added_wishlist: 'Added to “Want to try”', removed_wishlist: 'Removed from the list', remove: 'Remove',
    react_heart: 'Useful', react_clown: 'Clown', change_avatar: 'Profile photo', choose_photo: 'Choose photo',
    stat_reviews: 'reviews', stat_places: 'establishments', badges: 'Badges', badge: 'Badge', no_badges: 'No badges yet. They appear here as you earn them — some are a surprise 🤫',
    badge_earned: '✓ Earned', new_badge: '🎉 New badge!', badge_locked: 'Not yet — here’s how to get it', add: 'Add',
    hours: 'Opening hours', hours_unknown: 'Hours unknown', open_now: 'Open now', closed_now: 'Closed',
    hours_hint: 'Leave empty if unknown. Late hours like 18:00–02:00 work too.',
    errors: {
      auth_required: 'Please sign in first', bad_token: 'Sign-in expired, please sign in again',
      token_expired: 'Sign-in expired, please sign in again', forbidden: 'Not allowed',
      name_required: 'Name is required', place_exists: 'This establishment is already on the map',
      dish_exists: 'This dish already exists here', bad_rating: 'Choose a rating from 0 to 10',
      photo_too_large: 'Photo is too large', busy_try_again: 'Server is busy, try again',
      not_found: 'Not found — maybe it was deleted', network: 'No connection to the server',
      already_reviewed: 'You have already reviewed this dish', own_review: 'You can’t react to your own review',
      sign_in_failed: 'Sign-in failed, please try again', banned: 'Your account is blocked', not_configured: 'The app is not configured yet',
    },
  };

  const ru = {
    tab_map: 'Карта', tab_places: 'Заведения', tab_top: 'Топ', tab_profile: 'Профиль',
    not_configured: 'Не настроено: укажите API_URL и GOOGLE_CLIENT_ID в js/config.js',
    loading: 'Загрузка…', loading_data: 'Загружаем данные…', offline_cached: 'Нет сети — показаны сохранённые данные', refresh: 'Обновить',
    search_places: 'Поиск заведений…', search_dishes: 'Поиск блюд…',
    all: 'Все', only_reviewed: 'С отзывами', show_more: 'Показать ещё',
    no_places: 'Заведения не найдены', no_dishes: 'Блюд пока нет — добавьте первое!',
    no_reviews: 'Отзывов пока нет — будьте первым!', nothing_here: 'Здесь пока пусто',
    reviews_n: n => `${n} ${plural(n, 'отзыв', 'отзыва', 'отзывов')}`,
    dishes_n: n => `${n} ${plural(n, 'блюдо', 'блюда', 'блюд')}`,
    places_n: n => `${n} ${plural(n, 'место', 'места', 'мест')}`,
    open: 'Открыть', add_place: 'Добавить заведение', add_dish: 'Добавить блюдо',
    pick_location: 'Сдвиньте карту, чтобы метка указывала на заведение', confirm: 'Готово', cancel: 'Отмена',
    save: 'Сохранить', delete: 'Удалить', edit: 'Изменить', close: 'Закрыть', back: 'Назад',
    name: 'Название', address: 'Адрес', type: 'Тип', description: 'Краткое описание', category: 'Категория',
    price: 'Цена', optional: 'необязательно', photo: 'Фото', add_photo: 'Добавить фото', remove_photo: 'Убрать фото',
    top_dishes: 'Лучшие блюда', top_here: 'Лучшие блюда здесь', latest_reviews: 'Новые отзывы',
    top_hint: 'По рейтингу; блюда с большим числом отзывов весят больше.',
    your_rating: 'Ваша оценка', comment: 'Комментарий', comment_ph: 'Что понравилось или нет?',
    write_review: 'Написать отзыв', edit_review: 'Изменить мой отзыв', you: 'Вы', edited: 'изменён',
    sign_in: 'Войти через Google', sign_out: 'Выйти',
    sign_in_needed: 'Войдите, чтобы добавлять заведения, блюда и отзывы.',
    sign_in_trouble: 'Вход завис? Попробуйте другой способ', sign_in_failed: 'Не удалось войти, попробуйте ещё раз',
    display_name: 'Отображаемое имя', change_name: 'Изменить имя', my_reviews: 'Мои отзывы',
    language: 'Язык', admin: 'Модератор', install_hint: 'Совет: в меню браузера выберите «На экран „Домой“», чтобы установить приложение.',
    confirm_delete_review: 'Удалить этот отзыв?', confirm_delete_dish: 'Удалить блюдо и все отзывы о нём?',
    confirm_delete_place: 'Удалить заведение со всеми блюдами и отзывами?',
    saved: 'Сохранено', deleted: 'Удалено', error: 'Что-то пошло не так',
    at_place: 'в', by: '', map_attr: 'Карта',
    types: { cafe: 'Кафе', restaurant: 'Ресторан', fast_food: 'Фастфуд', bar: 'Бар / паб', coffee: 'Кофейня',
      bakery: 'Пекарня', canteen: 'Столовая', other: 'Другое' },
    cats: { soups: 'Супы', salads: 'Салаты', meat: 'Мясо', fish: 'Рыба', starters: 'Закуски', pelmeni: 'Пельмени',
      pasta: 'Паста', other_main: 'Другое основное', pizza: 'Пицца', burgers: 'Бургеры', sushi: 'Суши', shawarma: 'Шаурма',
      other_fast: 'Другой фастфуд', breakfast: 'Завтраки', business_lunch: 'Бизнес-ланч', bakery: 'Выпечка',
      desserts: 'Десерты', coffee: 'Кофе', tea: 'Чай', soft_drinks: 'Безалкогольные', alcohol: 'Алкоголь' },
    groups: { main: 'Основные блюда', fast_food: 'Фастфуд', breakfast: 'Завтраки', business_lunch: 'Бизнес-ланч',
      bakery: 'Выпечка', desserts: 'Десерты', starters: 'Закуски', drinks: 'Напитки' },
    subcategory: 'Подкатегория', types_pick: 'Тип (можно несколько)', pick_one_type: 'Выберите хотя бы один тип',
    lunch: 'Бизнес-ланч', lunch_q: 'Есть бизнес-ланч?', yes: 'Да', no: 'Нет', unknown: 'Неизвестно',
    lunch_from: 'С', lunch_to: 'До', lunch_menu: 'Меню ланча', lunch_menu_ph: 'Напр. Суп + горячее + напиток — 350 ₽',
    lunch_none: 'Бизнес-ланча нет', lunch_unknown: 'Пока нет информации', lunch_add: 'Добавить информацию', lunch_dishes: 'Блюда бизнес-ланча',
    has_lunch: 'Бизнес-ланч',
    lunch_menu_photo: 'Фото меню', add_menu_photo: 'Добавить фото меню', add_dish_photo: 'Добавить фото блюда',
    pick_photo: 'Сначала выберите фото', bad_image: 'Не удалось открыть изображение', optimizing: 'Сжимаем фото…',
    optimized: ([a, b]) => `Сжато: ${a} → ${b}`,
    want_to_try: 'Хочу попробовать', in_wishlist: 'В моём списке', wishlist: 'Хочу попробовать', rate_it: 'Оценить',
    wishlist_empty: 'Пока пусто. Нажмите 🔖 на блюде или в отзыве друга, чтобы сохранить на потом.',
    added_wishlist: 'Добавлено в «Хочу попробовать»', removed_wishlist: 'Убрано из списка', remove: 'Убрать',
    react_heart: 'Полезно', react_clown: 'Клоун', change_avatar: 'Фото профиля', choose_photo: 'Выбрать фото',
    stat_reviews: 'отзывов', stat_places: 'заведений', badges: 'Значки', badge: 'Значок', no_badges: 'Значков пока нет. Они появятся здесь, когда заработаешь — некоторые будут сюрпризом 🤫',
    badge_earned: '✓ Получен', new_badge: '🎉 Новый значок!', badge_locked: 'Ещё нет — вот как получить', add: 'Добавить',
    hours: 'Часы работы', hours_unknown: 'Часы работы неизвестны', open_now: 'Открыто', closed_now: 'Закрыто',
    hours_hint: 'Оставьте пустым, если неизвестно. Можно и поздние часы, например 18:00–02:00.',
    errors: {
      auth_required: 'Сначала войдите', bad_token: 'Сессия истекла, войдите снова',
      token_expired: 'Сессия истекла, войдите снова', forbidden: 'Нет прав',
      name_required: 'Укажите название', place_exists: 'Это заведение уже есть на карте',
      dish_exists: 'Такое блюдо здесь уже есть', bad_rating: 'Выберите оценку от 0 до 10',
      photo_too_large: 'Фото слишком большое', busy_try_again: 'Сервер занят, попробуйте ещё раз',
      not_found: 'Не найдено — возможно, удалено', network: 'Нет связи с сервером',
      already_reviewed: 'Вы уже оценили это блюдо', own_review: 'Нельзя реагировать на свой отзыв',
      sign_in_failed: 'Не удалось войти, попробуйте ещё раз', banned: 'Ваш аккаунт заблокирован', not_configured: 'Приложение ещё не настроено',
    },
  };

  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  // Two-step dish categories: group → subcategories. A group with [] is a category by itself.
  // Keep in sync with CATEGORIES in backend/Code.gs.
  const CAT_TREE = {
    main: ['soups', 'salads', 'meat', 'fish', 'pelmeni', 'pasta', 'other_main'],
    fast_food: ['pizza', 'burgers', 'sushi', 'shawarma', 'other_fast'],
    breakfast: [],
    business_lunch: [],
    bakery: [],
    desserts: [],
    starters: [], // shown as "Snacks" / "Закуски"; key kept so existing dishes and the backend stay valid
    drinks: ['coffee', 'tea', 'soft_drinks', 'alcohol'],
  };
  const GROUP_OF = {};
  Object.entries(CAT_TREE).forEach(([g, subs]) => { if (subs.length) subs.forEach(s => { GROUP_OF[s] = g; }); else GROUP_OF[g] = g; });
  const LEGACY = { dumplings: 'pelmeni', asian: 'other_main', street_food: 'other_fast', drinks: 'soft_drinks', other: 'other_main' };
  const normCat = k => { k = LEGACY[k] || k; return GROUP_OF[k] ? k : 'other_main'; };

  const dicts = { en, ru };
  let lang = 'en';
  try { lang = localStorage.getItem('lang') || ''; } catch (e) {}
  if (!dicts[lang]) lang = (navigator.language || '').toLowerCase().startsWith('ru') ? 'ru' : 'en';

  window.I18N = {
    get lang() { return lang; },
    setLang(l) { lang = dicts[l] ? l : 'en'; try { localStorage.setItem('lang', lang); } catch (e) {} },
    t(key, arg) {
      const v = dicts[lang][key] ?? en[key] ?? key;
      return typeof v === 'function' ? v(arg) : v;
    },
    type(k) { return dicts[lang].types[k] || dicts[lang].types.other; },
    types(list) { return (list || []).map(k => this.type(k)).join(', '); },
    cat(k) { k = normCat(k); return dicts[lang].cats[k] || dicts[lang].cats.other_main; },
    group(g) { return dicts[lang].groups[g] || g; },
    // "Fast food › Pizza", or just "Desserts" for single categories
    catFull(k) { k = normCat(k); const g = GROUP_OF[k]; return CAT_TREE[g].length ? `${this.group(g)} › ${this.cat(k)}` : this.cat(k); },
    groupOf(k) { return GROUP_OF[normCat(k)]; },
    normCat,
    err(code) { return dicts[lang].errors[code] || dicts[lang].error; },
    TYPES: Object.keys(en.types),
    CAT_TREE,
    GROUPS: Object.keys(CAT_TREE),
  };
})();
