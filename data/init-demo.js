
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

function initDemoDb() {
  const dataDir = path.join(__dirname);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

  const demoDbPath = path.join(dataDir, 'demo.sqlite');
  const db = new sqlite3.Database(demoDbPath);

  db.serialize(() => {
    // Abilita il controllo delle foreign key
    db.run('PRAGMA foreign_keys = ON');

    // Drop tabelle
    db.run('DROP TABLE IF EXISTS order_items');
    db.run('DROP TABLE IF EXISTS user_profiles');
    db.run('DROP TABLE IF EXISTS orders');
    db.run('DROP TABLE IF EXISTS products');
    db.run('DROP TABLE IF EXISTS categories');
    db.run('DROP TABLE IF EXISTS test_composite');
    db.run('DROP TABLE IF EXISTS users');

    // 1. Users
    db.run(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        email TEXT UNIQUE
      )
    `);

    // 2. User Profiles (1:1 opzionale)
    db.run(`
      CREATE TABLE user_profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL UNIQUE,
        bio TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // 3. Categories
    db.run(`
      CREATE TABLE categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
      )
    `);

    // 4. Products (N:1 verso categories)
    db.run(`
      CREATE TABLE products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        price REAL,
        category_id INTEGER NOT NULL,
        FOREIGN KEY (category_id) REFERENCES categories(id)
      )
    `);

    // 5. Orders (N:1 verso users)
    db.run(`
      CREATE TABLE orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        total REAL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // 6. Order Items
    db.run(`
      CREATE TABLE order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        FOREIGN KEY (order_id) REFERENCES orders(id),
        FOREIGN KEY (product_id) REFERENCES products(id)
      )
    `);

    // 7. Tabella con chiave univoca composta
    db.run(`
      CREATE TABLE test_composite (
        user_id INTEGER NOT NULL,
        category_id INTEGER NOT NULL,
        description TEXT,
        UNIQUE (user_id, category_id)
      )
    `);

    // -----------------------------------
    // INSERT DATI DEMO
    // -----------------------------------

    // USERS
    db.run(`
      INSERT INTO users (id, username, email) VALUES
      (1, 'mario.rossi', 'mario@example.com'),
      (2, 'anna.bianchi', 'anna@example.com'),
      (3, 'luca.verdi', 'luca@example.com'),
      (4, 'giulia.neri', 'giulia@example.com')
    `);

    // USER PROFILES
    // Giulia e Luca non hanno un profilo
    db.run(`
      INSERT INTO user_profiles (id, user_id, bio) VALUES
      (1, 1, 'Appassionato di tecnologia'),
      (2, 2, 'Designer e illustratrice'),
      (3, 3, 'Sviluppatore software')
    `);

    // CATEGORIES
    db.run(`
      INSERT INTO categories (id, name) VALUES
      (1, 'Informatica'),
      (2, 'Libri'),
      (3, 'Abbigliamento'),
      (4, 'Casa')
    `);

    // PRODUCTS
    // La categoria Casa non ha prodotti
    db.run(`
      INSERT INTO products (id, title, price, category_id) VALUES
      (1, 'Laptop Pro', 1299.99, 1),
      (2, 'Mouse Wireless', 29.90, 1),
      (3, 'Tastiera Meccanica', 89.90, 1),
      (4, 'Il Nome della Rosa', 14.50, 2),
      (5, 'Clean Code', 39.90, 2),
      (6, 'T-Shirt Basic', 19.90, 3)
    `);

    // ORDERS
    // Giulia non ha effettuato ordini
    db.run(`
      INSERT INTO orders (id, user_id, total) VALUES
      (1, 1, 1329.89),
      (2, 1, 39.90),
      (3, 2, 104.40),
      (4, 3, 59.80)
    `);

    // ORDER ITEMS
    db.run(`
      INSERT INTO order_items
        (id, order_id, product_id, quantity) VALUES
      (1, 1, 1, 1),
      (2, 1, 2, 1),
      (3, 2, 5, 1),
      (4, 3, 3, 1),
      (5, 3, 4, 1),
      (6, 4, 6, 2),
      (7, 4, 2, 1)
    `);

    // TEST COMPOSITE
    db.run(`
      INSERT INTO test_composite
        (user_id, category_id, description) VALUES
      (1, 1, 'Mario segue Informatica'),
      (1, 2, 'Mario segue Libri'),
      (2, 2, 'Anna segue Libri'),
      (3, 3, 'Luca segue Abbigliamento')
    `);
  });

  db.close();

  return demoDbPath;
}

module.exports = initDemoDb;
