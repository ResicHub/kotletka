// Friendly pop-up messages shown when the app opens (at most once every SHOW_EVERY_HOURS).
// Edit freely: {n} = a number, {name} = the user's display name.
window.MESSAGES = {
  SHOW_EVERY_HOURS: 3,
  SHOW_SECONDS: 5,       // how long the message stays fully visible (plus ~0.7 s fade in and out)
  PLACES_BELOW: 5,     // "add places" messages while the app has fewer places than this
  REVIEWS_BELOW: 10,   // "add reviews" messages while the app has fewer reviews than this

  // Shown first when the condition is true (priority: mine → places → reviews)
  mine: {   // the signed-in user has no reviews yet
    en: ['{name}, you haven’t rated anything yet. What did you eat last? 🤔',
         'Your first review is waiting. 10 stars or 0, just be honest 😄'],
    ru: ['{name}, вы ещё ничего не оценили. Что вы ели в последний раз? 🤔',
         'Ваш первый отзыв ждёт. 10 звёзд или 0, главное честно 😄'],
  },
  places: { // fewer than PLACES_BELOW places
    en: ['Only {n} cafes on the map so far. Know a good spot? Add it! 📍',
         'The map looks a bit hungry. Feed it a new сafe 🍽'],
    ru: ['На карте пока всего {n} мест. Знаете хорошее? Добавьте! 📍',
         'Карта немного проголодалась. Покормите её новым кафе 🍽'],
  },
  reviews: { // fewer than REVIEWS_BELOW reviews in total
    en: ['Only {n} reviews so far. Yours could help a friend pick lunch today',
         'Every review makes Kotletka tastier. Share one today ⭐'],
    ru: ['Пока всего {n} отзывов. Ваш может помочь другу выбрать обед',
         'Каждый отзыв делает Котлетку вкуснее. Поделитесь сегодня ⭐'],
  },

  // Random friendly messages when no condition above is true. Same position = same message in both languages.
  fun: {
    en: [
      'I hope it was delicious 😋',
      'Found something new today?',
      'Hungry? Peek at the Top tab for inspiration 🏆',
      'Dishes tastes better together 🌉',
      'Pelmeni are a food group. Change our mind 🥟',
      'Lunch time is sacred. Spend it well 🍲',
      'Tried a new place? Tell us before you forget the taste',
      'Good food, good mood ☀️',
      'Life is too short for a bad Kotletka',
      'Tell us honestly: was the borscht worth it? 🥣',
      'A good review is like a good recipe: worth sharing 📝',
      'Coffee first, reviews second ☕',
      'Somewhere near to you, a perfect Kotletka is waiting',
      'Your taste buds have opinions. Let them speak 👅',
      'Don’t forget a photo before the first bite 📸',
      'Business lunch hunting season is open 🎯',
      'Cold outside? Perfect weather for soup 🍜',
      'Dessert is never a bad idea 🍰',
      'Eat well, rate honestly, share generously!',
      'New day, new dish? 🌅',
      'Your friends trust your taste. Don’t keep it to yourself 🤝',
      'A 10/10 dish deserves to be famous ✨',
      'Even a bad meal makes a useful review 🙃',
      'Bon appétit! 🍴',
    ],
    ru: [
      'Надеюсь, было вкусно 😋',
      'Нашли сегодня что-то новое?',
      'Проголодались? Загляните в Топ за вдохновением 🏆',
      'Кушать вкуснее вместе 🌉',
      'Пельмени - это отдельная категория блюд. Переубедите нас 🥟',
      'Обеденный перерыв - святое. Проведите его с умом 🍲',
      'Попробовали новое место? Расскажите, пока помните вкус',
      'Вкусная еда - хорошее настроение ☀️',
      'Жизнь слишком коротка чтобы не попробовать Котлетку',
      'Скажите честно: борщ того стоил? 🥣',
      'Хороший отзыв как хороший рецепт: им стоит делиться 📝',
      'Сначала кофе, потом отзывы ☕',
      'Где-то рядом Вас ждёт идеальная Котлетка',
      'У Ваших вкусовых рецепторов есть мнение. Дайте им слово 👅',
      'Не забудьте сфотографировать до первого укуса 📸',
      'Сезон охоты на бизнес-ланчи открыт 🎯',
      'Холодно на улице? Идеальная погода для супа 🍜',
      'Десерт - всегда хорошая идея 🍰',
      'Ешьте вкусно, оценивайте честно, делитесь щедро!',
      'Новый день - новое блюдо? 🌅',
      'Друзья доверяют вашему вкусу. Не держите его при себе 🤝',
      'Блюдо на 10/10 заслуживает славы ✨',
      'Даже неудачный обед - полезный отзыв 🙃',
      'Приятного аппетита! 🍴',
    ],
  },
};
