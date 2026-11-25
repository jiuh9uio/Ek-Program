'use strict';
const { hashPassword } = require('../auth');

const DEFAULT_CATEGORIES = [
  'Alkoholfreie Getränke', 'Bier', 'Wein', 'Sekt und Champagner', 'Spirituosen', 'Liköre',
  'Cocktailzutaten', 'Sirup', 'Kaffee und Tee', 'Verbrauchsmaterialien', 'Reinigungsmittel',
  'Sonstige Serviceartikel',
];

const DEFAULT_UNITS = [
  ['Flasche', 'Flaschen'], ['Kasten', 'Kästen'], ['Karton', 'Kartons'], ['Stück', 'Stück'],
  ['Liter', 'Liter'], ['Packung', 'Packungen'], ['Dose', 'Dosen'], ['Fass', 'Fässer'],
  ['Kanister', 'Kanister'], ['Rolle', 'Rollen'], ['Beutel', 'Beutel'], ['Kilogramm', 'Kilogramm'],
];

const DEFAULT_LOCATIONS = ['Getränkelager', 'Bar', 'Weinkeller', 'Kühlhaus', 'Servicestation', 'Putzraum'];

function seedDefaults(db) {
  const now = new Date().toISOString();
  db.run("INSERT INTO departments(code, name, active) VALUES('service', 'Service', 1)");
  // Vorbereitet, aber deaktiviert: spätere Erweiterung um Kücheneinkauf.
  db.run("INSERT INTO departments(code, name, active) VALUES('kueche', 'Küche', 0)");
  DEFAULT_CATEGORIES.forEach((name, i) => db.run('INSERT INTO categories(department, name, sort_order) VALUES(?,?,?)', 'service', name, (i + 1) * 10));
  DEFAULT_UNITS.forEach(([n, p], i) => db.run('INSERT INTO units(name, plural, sort_order) VALUES(?,?,?)', n, p, (i + 1) * 10));
  DEFAULT_LOCATIONS.forEach((name, i) => db.run('INSERT INTO locations(department, name, sort_order) VALUES(?,?,?)', 'service', name, (i + 1) * 10));
  db.run(`INSERT INTO users(username, display_name, role, pass_hash, permissions, created_at, updated_at)
          VALUES('admin', 'Administrator', 'admin', ?, '[]', ?, ?)`, hashPassword('admin'), now, now);
  db.setSetting('company_name', 'Hotel & Restaurant');
  db.setSetting('check_valid_days', 7);
  db.setSetting('auto_backup', true);
  db.setSetting('backup_keep', 30);
  db.setSetting('default_admin_password', true);
  db.setSetting('session_hours', 12);
}

/** Beispieldaten zum Ausprobieren (nur auf Wunsch, nur wenn noch keine Artikel existieren). */
function seedDemo(db) {
  const now = new Date().toISOString();
  const cat = (n) => db.get("SELECT id FROM categories WHERE department='service' AND name=?", n)?.id ?? null;
  const unit = (n) => db.get('SELECT id FROM units WHERE name=?', n)?.id ?? null;
  const loc = (n) => db.get("SELECT id FROM locations WHERE department='service' AND name=?", n)?.id ?? null;
  const sup = (name, extra) => {
    const ex = db.get('SELECT id FROM suppliers WHERE name=?', name);
    if (ex) return ex.id;
    return Number(db.run(`INSERT INTO suppliers(name, customer_no, contact_person, phone, email, order_days, delivery_days, min_order_value, shipping_cost, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`, name, extra.no, extra.contact, extra.phone, extra.email, extra.order, extra.delivery, extra.mov, extra.ship, now, now).lastInsertRowid);
  };
  const getraenke = sup('Getränke Huber GmbH', { no: 'K-10442', contact: 'Frau Huber', phone: '+49 89 123456', email: 'bestellung@getraenke-huber.example', order: '1,4', delivery: '2,5', mov: 150, ship: 0 });
  const wein = sup('Weinhandel Rheingau', { no: '77812', contact: 'Herr Becker', phone: '+49 6723 9988', email: 'order@weinhandel.example', order: '2', delivery: '4', mov: 250, ship: 12.5 });
  const metro = sup('Großmarkt (Abholung)', { no: '0042-118', contact: '', phone: '', email: '', order: '', delivery: '', mov: 0, ship: 0 });

  const items = [
    ['AFG-001', 'Coca-Cola 0,2 l', 'Alkoholfreie Getränke', 'Coca-Cola', getraenke, 'Getränkelager', '24 x 0,2 l', 'Kasten', 14.9, 3, 10, 1, 1],
    ['AFG-002', 'Fanta 0,2 l', 'Alkoholfreie Getränke', 'Coca-Cola', getraenke, 'Getränkelager', '24 x 0,2 l', 'Kasten', 14.9, 2, 6, 1, 1],
    ['AFG-003', 'Mineralwasser 0,75 l', 'Alkoholfreie Getränke', 'Gerolsteiner', getraenke, 'Getränkelager', '12 x 0,75 l', 'Kasten', 9.8, 4, 12, 1, 1],
    ['BIE-001', 'Helles vom Fass 30 l', 'Bier', 'Augustiner', getraenke, 'Kühlhaus', '30 l', 'Fass', 89, 1, 4, 1, 1],
    ['WEI-001', 'Riesling trocken', 'Wein', 'Weingut Muster', wein, 'Weinkeller', '0,75 l', 'Flasche', 7.4, 6, 24, 6, 6],
    ['SEK-001', 'Crémant d’Alsace', 'Sekt und Champagner', 'Cave de Ribeauvillé', wein, 'Weinkeller', '0,75 l', 'Flasche', 9.9, 6, 18, 6, 6],
    ['SPI-001', 'Aperol', 'Spirituosen', 'Campari', metro, 'Bar', '1 l', 'Flasche', 12.5, 2, 6, 0, 1],
    ['SPI-002', 'Bacardi Carta Blanca', 'Spirituosen', 'Bacardi', metro, 'Bar', '0,7 l', 'Flasche', 11.2, 1, 4, 0, 1],
    ['SPI-003', 'Jack Daniel’s', 'Spirituosen', 'Brown-Forman', metro, 'Bar', '0,7 l', 'Flasche', 17.9, 1, 4, 0, 1],
    ['SIR-001', 'Sirup Vanille', 'Sirup', 'Monin', metro, 'Bar', '0,7 l', 'Flasche', 6.9, 1, 3, 0, 1],
    ['KAF-001', 'Espressobohnen', 'Kaffee und Tee', 'Rösterei', metro, 'Servicestation', '1 kg', 'Packung', 18.5, 3, 10, 0, 1],
    ['VER-001', 'Servietten 33x33 weiß', 'Verbrauchsmaterialien', 'Duni', metro, 'Servicestation', '250 Stk.', 'Packung', 4.2, 4, 12, 0, 2],
    ['REI-001', 'Gläserspülmittel', 'Reinigungsmittel', 'Winterhalter', metro, 'Putzraum', '10 l', 'Kanister', 38, 1, 3, 0, 1],
  ];
  for (const [no, name, c, man, s, l, pack, u, price, min, max, moq, step] of items) {
    if (db.get("SELECT id FROM articles WHERE department='service' AND article_no=?", no)) continue;
    db.run(`INSERT INTO articles(department, article_no, name, category_id, manufacturer, supplier_id, location_id, pack_size, unit_id, price_net,
      min_stock, max_stock, min_order_qty, order_step, created_at, updated_at) VALUES('service',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    no, name, cat(c), man, s, loc(l), pack, unit(u), price, min, max, moq, step, now, now);
  }
}

module.exports = { seedDefaults, seedDemo, DEFAULT_CATEGORIES };
