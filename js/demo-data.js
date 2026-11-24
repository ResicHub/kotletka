// Sample data for DEMO mode only. Invented places, not real reviews.
window.DEMO_SEED = (function () {
  const users = [
    { id: 'demo_me', name: 'You (demo)', role: 'admin' },
    { id: 'u_anna', name: 'Anna', role: 'user' },
    { id: 'u_dima', name: 'Dima K.', role: 'user' },
    { id: 'u_olga', name: 'Olga', role: 'user' },
    { id: 'u_sergey', name: 'Sergey', role: 'user' },
  ];
  const places = [
    { id: 'p1', name: 'Demo Pelmennaya “Taiga”', address: 'пр. Мира, 10', lat: 56.0115, lng: 92.8800, type: 'cafe' },
    { id: 'p2', name: 'Demo Bistro Yenisei', address: 'ул. Карла Маркса, 48', lat: 56.0128, lng: 92.8695, type: 'restaurant' },
    { id: 'p3', name: 'Demo Coffee Stolby', address: 'ул. Ленина, 113', lat: 56.0159, lng: 92.8605, type: 'coffee' },
    { id: 'p4', name: 'Demo Pizza Krsk', address: 'ул. Высотная, 2', lat: 56.0233, lng: 92.8300, type: 'fast_food' },
    { id: 'p5', name: 'Demo Sushi Bridge', address: 'ул. Взлётная, 7', lat: 56.0420, lng: 92.9050, type: 'restaurant' },
    { id: 'p6', name: 'Demo Canteen №5', address: 'пр. Свободный, 79', lat: 56.0050, lng: 92.7720, type: 'canteen' },
    { id: 'p7', name: 'Demo Bakery Sibir', address: 'ул. Матросова, 6', lat: 55.9940, lng: 92.9020, type: 'bakery' },
    { id: 'p8', name: 'Demo Burger Shed', address: 'ул. 9 Мая, 14', lat: 56.0640, lng: 92.9280, type: 'fast_food' },
    { id: 'p9', name: 'Demo Pub Embankment', address: 'ул. Дубровинского, 54', lat: 56.0080, lng: 92.8770, type: 'bar' },
  ].map(p => ({ ...p, created_by: 'osm', created_at: '2026-11-01T10:00:00Z' }));

  const D = (id, place_id, name, category, price, description) =>
    ({ id, place_id, name, category, price, description, photo_id: '', created_by: 'u_anna', created_at: '2026-11-02T10:00:00Z' });
  const dishes = [
    D('d1', 'p1', 'Siberian pelmeni', 'dumplings', 390, 'Beef & pork, with sour cream'),
    D('d2', 'p1', 'Borscht', 'soups', 320, 'Classic, with garlic pampushki'),
    D('d3', 'p1', 'Vareniki with cherry', 'dumplings', 350, ''),
    D('d4', 'p2', 'Muksun stroganina', 'fish', 690, 'Frozen Yenisei fish, thin slices'),
    D('d5', 'p2', 'Venison steak', 'meat', 1450, ''),
    D('d6', 'p2', 'Olivier salad', 'salads', 380, ''),
    D('d7', 'p3', 'Flat white', 'coffee', 260, ''),
    D('d8', 'p3', 'Cheesecake', 'desserts', 340, 'New York style'),
    D('d9', 'p3', 'Syrniki', 'breakfast', 360, 'With berry jam'),
    D('d10', 'p4', 'Pepperoni 30 cm', 'pizza', 650, ''),
    D('d11', 'p4', 'Four cheese', 'pizza', 690, ''),
    D('d12', 'p5', 'Philadelphia roll', 'sushi', 590, ''),
    D('d13', 'p5', 'Tom yum', 'asian', 520, 'Spicy, with shrimps'),
    D('d14', 'p6', 'Business lunch', 'other', 290, 'Soup + main + compote'),
    D('d15', 'p7', 'Pirozhok with cabbage', 'bakery', 70, ''),
    D('d16', 'p8', 'Double cheeseburger', 'burgers', 490, ''),
    D('d17', 'p9', 'Local craft lager', 'drinks', 300, ''),
  ];

  let n = 0;
  const R = (dish_id, user_id, rating, comment, daysAgo) => {
    const d = dishes.find(x => x.id === dish_id);
    const t = new Date(Date.now() - daysAgo * 86400000 - (n * 3600000)).toISOString();
    return { id: 'r' + (++n), dish_id, place_id: d.place_id, user_id, rating, comment, photo_id: '', created_at: t, updated_at: t };
  };
  const reviews = [
    R('d1', 'u_anna', 9, 'Best pelmeni in the centre, generous portion.', 1),
    R('d1', 'u_dima', 8, 'Very good, a bit salty this time.', 3),
    R('d1', 'u_olga', 10, 'Like grandma’s! Must try.', 6),
    R('d2', 'u_sergey', 7, 'Tasty but small bowl for the price.', 2),
    R('d3', 'u_anna', 8, 'Sweet and sour, loved it.', 8),
    R('d4', 'u_dima', 10, 'Real Siberian stroganina, super fresh.', 4),
    R('d4', 'u_sergey', 9, 'Bring friends from Moscow here.', 9),
    R('d5', 'u_olga', 6, 'Slightly overcooked, sauce was great.', 5),
    R('d7', 'u_anna', 8, 'Good beans, nice latte art.', 0),
    R('d8', 'u_olga', 9, 'Creamy, not too sweet.', 2),
    R('d9', 'u_dima', 7, 'OK syrniki, jam is the star.', 7),
    R('d10', 'u_sergey', 6, 'Average, fast delivery though.', 3),
    R('d11', 'u_anna', 7, 'Cheesy enough.', 10),
    R('d12', 'u_olga', 5, 'Too much rice.', 4),
    R('d13', 'u_dima', 9, 'Properly spicy, recommend!', 1),
    R('d14', 'u_sergey', 8, 'Cheap and filling, student favourite.', 2),
    R('d15', 'u_olga', 9, 'Warm and fresh in the morning.', 0),
    R('d16', 'u_dima', 7, 'Juicy, fries were cold.', 5),
  ];

  return { users, places, dishes, reviews };
})();
