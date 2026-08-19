/* ============================================================
   words.js — the built-in categories.

   Each category is a flat list of secret words. Keep the lists a
   similar length: a category is picked first, then a word inside
   it, so a short list makes its words more likely to come up.
   ============================================================ */
(function (global) {
  'use strict';

  var CATEGORIES = [
    {
      id: 'animals', emoji: '🐾', name: 'Animals',
      words: [
        'Elephant', 'Penguin', 'Kangaroo', 'Octopus', 'Giraffe', 'Hedgehog',
        'Dolphin', 'Crocodile', 'Squirrel', 'Flamingo', 'Tiger', 'Owl',
        'Camel', 'Sloth', 'Bat', 'Wolf', 'Rabbit', 'Hamster', 'Snake',
        'Shark', 'Bee', 'Butterfly', 'Frog', 'Horse', 'Goat', 'Chicken',
        'Parrot', 'Panda', 'Koala', 'Zebra', 'Whale', 'Spider', 'Turtle',
        'Monkey', 'Polar bear', 'Seal', 'Raccoon', 'Peacock'
      ]
    },
    {
      id: 'food', emoji: '🍔', name: 'Food & Drink',
      words: [
        'Pizza', 'Sushi', 'Pancakes', 'Ice cream', 'Spaghetti', 'Tacos',
        'Popcorn', 'Hot dog', 'Cheeseburger', 'Salad', 'Soup', 'Curry',
        'Bacon', 'Cereal', 'Chocolate', 'Doughnut', 'Coffee', 'Lemonade',
        'Milkshake', 'Pretzel', 'Peanut butter', 'Cheese', 'Watermelon',
        'Pickle', 'Toast', 'Omelette', 'Fried chicken', 'Noodles',
        'Barbecue', 'Birthday cake', 'Marshmallow', 'Garlic bread',
        'Hot sauce', 'Smoothie', 'Sandwich', 'Waffle', 'Nachos', 'Bubble tea'
      ]
    },
    {
      id: 'movies', emoji: '🎬', name: 'Movies',
      words: [
        'Titanic', 'Jurassic Park', 'The Lion King', 'Star Wars', 'Jaws',
        'Frozen', 'Rocky', 'Home Alone', 'The Matrix', 'Shrek', 'Toy Story',
        'Ghostbusters', 'Avatar', 'The Godfather', 'Finding Nemo',
        'Back to the Future', 'Harry Potter', 'Indiana Jones',
        'The Wizard of Oz', 'Top Gun', 'Forrest Gump', 'Men in Black',
        'Mary Poppins', 'Jumanji', 'The Terminator', 'Spider-Man', 'Grease',
        'Pirates of the Caribbean', 'Casablanca', 'Despicable Me',
        'King Kong', 'The Hunger Games', 'Mrs Doubtfire', 'Gladiator',
        'Inception', 'The Sound of Music', 'Cast Away', 'Night at the Museum'
      ]
    },
    {
      id: 'jobs', emoji: '💼', name: 'Jobs',
      words: [
        'Firefighter', 'Dentist', 'Astronaut', 'Chef', 'Teacher', 'Plumber',
        'Lifeguard', 'Pilot', 'Farmer', 'Barber', 'Nurse', 'Judge', 'Lawyer',
        'Accountant', 'Magician', 'Clown', 'Referee', 'Journalist',
        'Photographer', 'Electrician', 'Bus driver', 'Librarian', 'Vet',
        'Architect', 'Detective', 'Soldier', 'Scientist', 'Waiter',
        'Mechanic', 'Tattoo artist', 'DJ', 'Bodyguard', 'Dog walker',
        'Flight attendant', 'Postman', 'Builder', 'Surgeon', 'Beekeeper'
      ]
    },
    {
      id: 'places', emoji: '🌍', name: 'Places',
      words: [
        'Paris', 'Egypt', 'The Moon', 'Hawaii', 'Antarctica', 'Las Vegas',
        'Venice', 'Tokyo', 'The Amazon', 'Iceland', 'New York', 'London',
        'The Sahara', 'Mount Everest', 'Australia', 'Grand Canyon',
        'Niagara Falls', 'Rome', 'Ireland', 'Jamaica', 'Switzerland',
        'Dubai', 'Alaska', 'Route 66', 'Machu Picchu', 'Great Wall of China',
        'Bermuda Triangle', 'Silicon Valley', 'Hollywood', 'Amsterdam',
        'Scotland', 'Greece', 'Texas', 'Norway', 'Kenya', 'Cuba',
        'Thailand', 'Times Square'
      ]
    },
    {
      id: 'sports', emoji: '⚽', name: 'Sports & Games',
      words: [
        'Football', 'Basketball', 'Golf', 'Swimming', 'Boxing', 'Tennis',
        'Skiing', 'Surfing', 'Bowling', 'Gymnastics', 'Ice hockey',
        'Baseball', 'Cycling', 'Marathon', 'Rock climbing', 'Chess', 'Darts',
        'Skateboarding', 'Figure skating', 'Sumo wrestling', 'Archery',
        'Fencing', 'Rugby', 'Cricket', 'Volleyball', 'Karate',
        'Horse racing', 'Table tennis', 'Scuba diving', 'Bungee jumping',
        'Yoga', 'Weightlifting', 'Curling', 'Poker', 'Hide and seek',
        'Tug of war', 'Paintball', 'Formula 1'
      ]
    },
    {
      id: 'house', emoji: '🏠', name: 'Around the House',
      words: [
        'Toaster', 'Vacuum cleaner', 'Sofa', 'Shower', 'Fridge', 'Doorbell',
        'Mirror', 'Pillow', 'Washing machine', 'Kettle', 'Bookshelf',
        'Staircase', 'Chimney', 'Garage', 'Mailbox', 'Alarm clock',
        'Toilet', 'Laundry basket', 'Microwave', 'Dishwasher',
        'Ironing board', 'Light switch', 'Candle', 'Rug', 'Curtains',
        'Attic', 'Basement', 'Broom', 'Smoke alarm', 'Coat hanger',
        'Chopping board', 'Bathtub', 'Ceiling fan', 'Front porch',
        'Junk drawer', 'Spare key', 'Litter tray', 'Watering can'
      ]
    },
    {
      id: 'travel', emoji: '✈️', name: 'Travel',
      words: [
        'Passport', 'Suitcase', 'Airport', 'Hotel', 'Beach', 'Road trip',
        'Cruise ship', 'Campsite', 'Souvenir', 'Sunscreen', 'Train station',
        'Backpack', 'Map', 'Boarding pass', 'Jet lag', 'Lost luggage',
        'Duty free', 'Taxi', 'Hostel', 'Ferry', 'Tour guide', 'Postcard',
        'Snorkelling', 'Safari', 'Ski resort', 'Traffic jam',
        'Motorway services', 'Theme park', 'Museum', 'Cable car',
        'Hot air balloon', 'Rental car', 'Border control',
        'Travel insurance', 'Airport security', 'Window seat',
        'Room service', 'Sightseeing bus'
      ]
    },
    {
      id: 'music', emoji: '🎵', name: 'Music',
      words: [
        'Guitar', 'Drums', 'Karaoke', 'Opera', 'Rap', 'Choir', 'Violin',
        'Piano', 'Bagpipes', 'Jazz', 'Headphones', 'Music festival',
        'Ringtone', 'National anthem', 'Elvis', 'The Beatles', 'DJ',
        'Saxophone', 'Trumpet', 'Ukulele', 'Boy band', 'Air guitar',
        'Vinyl record', 'Lullaby', 'Marching band', 'Hip hop',
        'Country music', 'Heavy metal', 'Accordion', 'Triangle',
        'Harmonica', 'Beatboxing', 'Encore', 'Backup dancer', 'Guitar solo',
        'Cowbell', 'Whistling', 'Kazoo'
      ]
    },
    {
      id: 'school', emoji: '🎒', name: 'School',
      words: [
        'Homework', 'Detention', 'Break time', 'Cafeteria', 'Chalkboard',
        'Report card', 'Field trip', 'Gym class', 'Locker',
        'Substitute teacher', 'School bus', 'Science fair', 'Spelling test',
        'Playground', 'Rucksack', 'Prom', 'Graduation', 'Yearbook',
        "Principal's office", 'Group project', 'Pop quiz', 'Library',
        'Hall pass', 'Lunch box', 'Show and tell', 'Exam', 'Uniform',
        'Head teacher', 'Parents evening', 'School play', 'The bell',
        'Ruler', 'Glue stick', 'Nap time', 'Summer holidays', 'Fire drill',
        'Assembly', 'Pencil sharpener'
      ]
    },
    {
      id: 'tech', emoji: '📱', name: 'Tech',
      words: [
        'Wi-Fi', 'Smartphone', 'Password', 'Emoji', 'Video call', 'Selfie',
        'Group chat', 'Autocorrect', 'Battery', 'Cloud storage', 'Robot',
        'Drone', 'Search engine', 'Spam email', 'Firewall', 'USB stick',
        'Bluetooth', 'Smart watch', 'Streaming', 'Podcast', 'Screenshot',
        'Aeroplane mode', 'Charging cable', 'QR code', 'Voice assistant',
        'Software update', 'Meme', 'Livestream', 'Printer', 'Keyboard',
        'Dark mode', 'Two-factor code', 'Screen time', 'Notification',
        'Data plan', 'Touchscreen', 'Algorithm', 'Delete button'
      ]
    },
    {
      id: 'people', emoji: '🧑', name: 'People',
      words: [
        'Charlie Chaplin', 'Marilyn Monroe', 'Tom Hanks', 'Audrey Hepburn',
        'Arnold Schwarzenegger', 'Jackie Chan', 'Oprah Winfrey',
        'Elvis Presley', 'Freddie Mercury', 'Bob Marley', 'Dolly Parton',
        'Beyoncé', 'Mozart', 'Albert Einstein', 'Isaac Newton',
        'Marie Curie', 'Leonardo da Vinci', 'Charles Darwin', 'Nikola Tesla',
        'Cleopatra', 'Julius Caesar', 'Napoleon', 'Abraham Lincoln',
        'Winston Churchill', 'Joan of Arc', 'Queen Elizabeth II',
        'Nelson Mandela', 'Muhammad Ali', 'Michael Jordan', 'Serena Williams',
        'Usain Bolt', 'Pelé', 'William Shakespeare', 'Vincent van Gogh',
        'Walt Disney', 'Neil Armstrong', 'Harry Houdini', 'David Attenborough'
      ]
    },
    {
      id: 'transport', emoji: '🚗', name: 'Transport',
      words: [
        'Bicycle', 'Helicopter', 'Submarine', 'Skateboard', 'Ambulance',
        'Hot air balloon', 'Motorbike', 'Tractor', 'Rocket', 'School bus',
        'Canoe', 'Segway', 'Ice cream van', 'Tram', 'Fire engine',
        'Golf cart', 'Sledge', 'Limousine', 'Ferry', 'Escalator',
        'Lift', 'Roller coaster', 'Horse and cart', 'Jet ski',
        'Monster truck', 'Taxi', 'Zeppelin', 'Pogo stick', 'Rickshaw',
        'Forklift', 'Snowmobile', 'Hovercraft', 'Unicycle', 'Cable car',
        'Bin lorry', 'Tow truck', 'Camper van', 'Roller skates'
      ]
    },
    {
      id: 'nature', emoji: '🌦️', name: 'Nature',
      words: [
        'Thunderstorm', 'Rainbow', 'Volcano', 'Waterfall', 'Desert',
        'Earthquake', 'Snowflake', 'Tornado', 'Coral reef', 'Forest fire',
        'Cave', 'Glacier', 'Sunrise', 'Fog', 'Quicksand', 'The tide',
        'Hurricane', 'Northern lights', 'Eclipse', 'Meteor', 'Swamp',
        'Canyon', 'Geyser', 'Avalanche', 'Rain shower', 'Full moon',
        'Sand dune', 'Iceberg', 'Jungle', 'Lightning', 'Autumn leaves',
        'Puddle', 'Mushroom', 'Cactus', 'Beehive', 'Cobweb', 'Seashell',
        'Shooting star'
      ]
    },
    {
      id: 'celebrations', emoji: '🎉', name: 'Celebrations',
      words: [
        'Birthday party', 'Christmas tree', 'Halloween costume',
        'Easter egg hunt', 'Fireworks', "New Year's Eve", 'Wedding',
        'Baby shower', 'Graduation', 'Anniversary', 'Secret Santa',
        'Trick or treat', 'Thanksgiving dinner', "Valentine's Day",
        'Piñata', 'Confetti', 'Party hat', 'Wedding cake',
        'Best man speech', 'Bouquet', 'Christmas stocking',
        'Advent calendar', 'Mistletoe', 'Pumpkin carving', 'Ghost costume',
        'Sparkler', 'Champagne toast', 'Gift wrapping', 'Birthday candles',
        'Karaoke night', 'Barbecue', 'Housewarming', 'Retirement party',
        'Stag do', 'First dance', 'Christmas jumper', 'Fancy dress',
        'The countdown'
      ]
    }
  ];

  global.ImposterWords = { CATEGORIES: CATEGORIES };

})(this);
