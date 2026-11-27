// Eingebauter Produktkatalog (offline) für die schnelle Artikelanlage im Service.
// Enthält typische Gebinde/Bestelleinheiten – bewusst OHNE Preise und EAN (bitte mit dem Lieferanten abgleichen).
//
// Format: [Name, Hersteller, Kategorie, [[Größe, Einheit, [[Bestelleinheit, Inhalt], …]], …]]

const B05 = ['0,5 l', 'Flasche', [['Kasten', 20]]];
const B033 = ['0,33 l', 'Flasche', [['Kasten', 24]]];
const F30 = ['30 l', 'Fass', []];
const F50 = ['50 l', 'Fass', []];
const SP07 = ['0,7 l', 'Flasche', [['Karton', 6]]];
const SP10 = ['1,0 l', 'Flasche', [['Karton', 6]]];
const W075 = ['0,75 l', 'Flasche', [['Karton', 6]]];
const W10 = ['1,0 l', 'Flasche', [['Karton', 6]]];
const PIC = ['0,2 l', 'Flasche', [['Karton', 24]]];
const G02 = ['0,2 l', 'Flasche', [['Kasten', 24]]];
const G033 = ['0,33 l', 'Flasche', [['Kasten', 24]]];
const G10 = ['1,0 l', 'Flasche', [['Kasten', 12]]];
const DOSE033 = ['0,33 l Dose', 'Dose', [['Karton', 24]]];
const J10 = ['1,0 l', 'Flasche', [['Karton', 6]]];
const MON07 = ['0,7 l', 'Flasche', [['Karton', 6]]];

const AFG = 'Alkoholfreie Getränke'; const BIER = 'Bier'; const WEIN = 'Wein'; const SEKT = 'Sekt und Champagner';
const SPI = 'Spirituosen'; const LIK = 'Liköre'; const COCK = 'Cocktailzutaten'; const SIR = 'Sirup'; const KAF = 'Kaffee und Tee';
const VER = 'Verbrauchsmaterialien'; const REI = 'Reinigungsmittel';

const RAW = [
  // --- Alkoholfreie Getränke ---
  ['Coca-Cola', 'Coca-Cola', AFG, [G02, G033, G10, DOSE033]],
  ['Coca-Cola Zero', 'Coca-Cola', AFG, [G02, G033, G10, DOSE033]],
  ['Coca-Cola light', 'Coca-Cola', AFG, [G02, G033]],
  ['Fanta Orange', 'Coca-Cola', AFG, [G02, G033, G10]],
  ['Sprite', 'Coca-Cola', AFG, [G02, G033, G10]],
  ['Mezzo Mix', 'Coca-Cola', AFG, [G02, G033]],
  ['Paulaner Spezi', 'Paulaner', AFG, [B05]],
  ['Schweppes Indian Tonic Water', 'Schweppes', AFG, [G02]],
  ['Schweppes Ginger Ale', 'Schweppes', AFG, [G02]],
  ['Schweppes Bitter Lemon', 'Schweppes', AFG, [G02]],
  ['Fever-Tree Premium Indian Tonic Water', 'Fever-Tree', AFG, [['0,2 l', 'Flasche', [['Karton', 24]]]]],
  ['Fever-Tree Mediterranean Tonic Water', 'Fever-Tree', AFG, [['0,2 l', 'Flasche', [['Karton', 24]]]]],
  ['Fever-Tree Ginger Beer', 'Fever-Tree', AFG, [['0,2 l', 'Flasche', [['Karton', 24]]]]],
  ['Thomas Henry Tonic Water', 'Thomas Henry', AFG, [G02]],
  ['Thomas Henry Ginger Beer', 'Thomas Henry', AFG, [G02]],
  ['Red Bull Energy Drink', 'Red Bull', AFG, [['0,25 l Dose', 'Dose', [['Karton', 24]]]]],
  ['Bionade Holunder', 'Bionade', AFG, [G033]],
  ['fritz-kola', 'fritz-kulturgüter', AFG, [G033]],
  ['Apfelschorle', '', AFG, [G02, ['0,5 l', 'Flasche', [['Kasten', 20]]]]],
  ['Granini Orangensaft', 'Granini', AFG, [G02, J10]],
  ['Granini Apfelsaft', 'Granini', AFG, [G02, J10]],
  ['Granini Multivitamin', 'Granini', AFG, [G02, J10]],
  ['Granini Johannisbeere', 'Granini', AFG, [G02, J10]],
  ['Gerolsteiner Sprudel', 'Gerolsteiner', AFG, [['0,25 l', 'Flasche', [['Kasten', 24]]], ['0,75 l', 'Flasche', [['Kasten', 12]]]]],
  ['Gerolsteiner Medium', 'Gerolsteiner', AFG, [['0,25 l', 'Flasche', [['Kasten', 24]]], ['0,75 l', 'Flasche', [['Kasten', 12]]]]],
  ['Gerolsteiner Naturell', 'Gerolsteiner', AFG, [['0,25 l', 'Flasche', [['Kasten', 24]]], ['0,75 l', 'Flasche', [['Kasten', 12]]]]],
  ['S.Pellegrino', 'Sanpellegrino', AFG, [['0,25 l', 'Flasche', [['Karton', 24]]], ['0,75 l', 'Flasche', [['Karton', 15]]]]],
  ['Acqua Panna', 'Sanpellegrino', AFG, [['0,25 l', 'Flasche', [['Karton', 24]]], ['0,75 l', 'Flasche', [['Karton', 15]]]]],
  ['Mineralwasser classic', '', AFG, [['0,25 l', 'Flasche', [['Kasten', 24]]], ['0,75 l', 'Flasche', [['Kasten', 12]]]]],
  ['Mineralwasser still', '', AFG, [['0,25 l', 'Flasche', [['Kasten', 24]]], ['0,75 l', 'Flasche', [['Kasten', 12]]]]],
  // --- Bier ---
  ['Augustiner Lagerbier Hell', 'Augustiner-Bräu', BIER, [B05, F30, F50]],
  ['Augustiner Edelstoff', 'Augustiner-Bräu', BIER, [B05]],
  ['Paulaner Original Münchner Hell', 'Paulaner', BIER, [B05, F30, F50]],
  ['Paulaner Hefe-Weißbier Naturtrüb', 'Paulaner', BIER, [B05, F30, F50]],
  ['Erdinger Weißbier', 'Erdinger Weißbräu', BIER, [B05, F30, F50]],
  ['Erdinger Alkoholfrei', 'Erdinger Weißbräu', BIER, [B05, B033]],
  ['Franziskaner Hefe-Weissbier Naturtrüb', 'Spaten-Franziskaner-Bräu', BIER, [B05, F30, F50]],
  ['Tegernseer Hell', 'Herzoglich Bayerisches Brauhaus Tegernsee', BIER, [B05]],
  ['Bitburger Premium Pils', 'Bitburger', BIER, [B05, B033, F30, F50]],
  ['Krombacher Pils', 'Krombacher', BIER, [B05, B033, F30, F50]],
  ['Warsteiner Premium Pilsener', 'Warsteiner', BIER, [B05, B033, F30, F50]],
  ['Veltins Pilsener', 'Veltins', BIER, [B05, B033, F30, F50]],
  ["Beck's Pils", "Beck's", BIER, [B05, B033, F30, F50]],
  ["Beck's Blue Alkoholfrei", "Beck's", BIER, [B033]],
  ['Jever Pilsener', 'Jever', BIER, [B05, B033]],
  ['Radeberger Pilsner', 'Radeberger', BIER, [B05, B033, F30, F50]],
  ['Rothaus Pils Tannenzäpfle', 'Rothaus', BIER, [B033]],
  ['Clausthaler Original Alkoholfrei', 'Clausthaler', BIER, [B05, B033]],
  ['Schöfferhofer Grapefruit', 'Schöfferhofer', BIER, [B05, B033]],
  ['Früh Kölsch', 'Cölner Hofbräu Früh', BIER, [['0,33 l', 'Flasche', [['Kasten', 24]]], ['0,5 l', 'Flasche', [['Kasten', 20]]], F30]],
  ['Gaffel Kölsch', 'Gaffel', BIER, [['0,33 l', 'Flasche', [['Kasten', 24]]], ['0,5 l', 'Flasche', [['Kasten', 20]]], F30]],
  ['Radler', '', BIER, [B05, B033]],
  // --- Wein (Rebsorten, Hersteller frei) ---
  ['Riesling trocken', '', WEIN, [W075, W10]],
  ['Grauburgunder trocken', '', WEIN, [W075, W10]],
  ['Weißburgunder trocken', '', WEIN, [W075, W10]],
  ['Sauvignon Blanc', '', WEIN, [W075]],
  ['Chardonnay', '', WEIN, [W075]],
  ['Müller-Thurgau', '', WEIN, [W075, W10]],
  ['Silvaner trocken', '', WEIN, [W075]],
  ['Rosé trocken', '', WEIN, [W075, W10]],
  ['Spätburgunder trocken', '', WEIN, [W075, W10]],
  ['Dornfelder', '', WEIN, [W075, W10]],
  ['Lemberger', '', WEIN, [W075]],
  ['Primitivo', '', WEIN, [W075]],
  ['Merlot', '', WEIN, [W075]],
  ['Chianti Classico', '', WEIN, [W075]],
  ['Rioja Crianza', '', WEIN, [W075]],
  ['Hauswein weiß (Ausschank)', '', WEIN, [W10, ['5 l Bag-in-Box', 'Packung', []]]],
  ['Hauswein rot (Ausschank)', '', WEIN, [W10, ['5 l Bag-in-Box', 'Packung', []]]],
  // --- Sekt & Champagner ---
  ['Rotkäppchen Sekt trocken', 'Rotkäppchen', SEKT, [W075, PIC]],
  ['Henkell Trocken', 'Henkell', SEKT, [W075, PIC]],
  ['Mumm Dry', 'Mumm', SEKT, [W075, PIC]],
  ['Freixenet Carta Nevada', 'Freixenet', SEKT, [W075, PIC]],
  ['Prosecco DOC Spumante', '', SEKT, [W075, PIC]],
  ['Prosecco Frizzante', '', SEKT, [W075]],
  ['Crémant d’Alsace Brut', '', SEKT, [W075]],
  ['Moët & Chandon Brut Impérial', 'Moët & Chandon', SEKT, [W075]],
  ['Veuve Clicquot Brut', 'Veuve Clicquot', SEKT, [W075]],
  // --- Spirituosen ---
  ['Aperol', 'Campari Group', SPI, [SP07, SP10]],
  ['Campari Bitter', 'Campari Group', SPI, [SP07, SP10]],
  ['Bacardi Carta Blanca', 'Bacardi', SPI, [SP07, SP10]],
  ['Havana Club Añejo 3 Años', 'Havana Club', SPI, [SP07]],
  ['Havana Club Añejo 7 Años', 'Havana Club', SPI, [SP07]],
  ['Captain Morgan Spiced Gold', 'Diageo', SPI, [SP07]],
  ['Absolut Vodka', 'Absolut', SPI, [SP07, SP10]],
  ['Smirnoff Vodka', 'Diageo', SPI, [SP07]],
  ['Grey Goose Vodka', 'Bacardi', SPI, [SP07]],
  ["Gordon's London Dry Gin", 'Diageo', SPI, [SP07]],
  ['Bombay Sapphire Gin', 'Bacardi', SPI, [SP07, SP10]],
  ["Hendrick's Gin", 'William Grant & Sons', SPI, [SP07]],
  ['Tanqueray London Dry Gin', 'Diageo', SPI, [SP07]],
  ['Monkey 47 Schwarzwald Dry Gin', 'Black Forest Distillers', SPI, [['0,5 l', 'Flasche', [['Karton', 6]]]]],
  ["Jack Daniel's Old No. 7", 'Brown-Forman', SPI, [SP07, SP10]],
  ['Jameson Irish Whiskey', 'Irish Distillers', SPI, [SP07]],
  ['Johnnie Walker Red Label', 'Diageo', SPI, [SP07]],
  ['Johnnie Walker Black Label', 'Diageo', SPI, [SP07]],
  ["Ballantine's Finest", 'Pernod Ricard', SPI, [SP07]],
  ['Jägermeister', 'Mast-Jägermeister', SPI, [SP07, SP10]],
  ['Ramazzotti Amaro', 'Pernod Ricard', SPI, [SP07]],
  ['Averna Amaro Siciliano', 'Campari Group', SPI, [SP07]],
  ['Fernet-Branca', 'Fratelli Branca', SPI, [SP07]],
  ['Tequila Blanco', '', SPI, [SP07]],
  ['Grappa', '', SPI, [SP07]],
  ['Obstbrand Williams-Christ-Birne', '', SPI, [['0,5 l', 'Flasche', [['Karton', 6]]], SP07]],
  ['Obstbrand Kirschwasser', '', SPI, [['0,5 l', 'Flasche', [['Karton', 6]]], SP07]],
  // --- Liköre & Aperitifs ---
  ["Baileys Original Irish Cream", 'Diageo', LIK, [SP07]],
  ['Kahlúa Kaffeelikör', 'Pernod Ricard', LIK, [SP07]],
  ['Malibu Kokoslikör', 'Pernod Ricard', LIK, [SP07]],
  ['Licor 43', 'Diego Zamora', LIK, [SP07]],
  ['Cointreau', 'Rémy Cointreau', LIK, [SP07]],
  ['Disaronno Amaretto', 'Illva Saronno', LIK, [SP07]],
  ['Lillet Blanc', 'Pernod Ricard', LIK, [['0,75 l', 'Flasche', [['Karton', 6]]]]],
  ['Martini Bianco', 'Bacardi', LIK, [['0,75 l', 'Flasche', [['Karton', 6]]], SP10]],
  ['Sambuca', '', LIK, [SP07]],
  ['Limoncello', '', LIK, [SP07]],
  ['Holunderblütenlikör', '', LIK, [SP07]],
  // --- Cocktailzutaten ---
  ['Angostura Aromatic Bitters', 'Angostura', COCK, [['0,2 l', 'Flasche', []]]],
  ['Limettensaft', '', COCK, [['0,7 l', 'Flasche', [['Karton', 6]]]]],
  ['Zitronensaft', '', COCK, [['0,7 l', 'Flasche', [['Karton', 6]]]]],
  ['Maracujanektar', '', COCK, [J10]],
  ['Ananassaft', '', COCK, [J10]],
  ['Cranberrynektar', '', COCK, [J10]],
  ['Tomatensaft', '', COCK, [J10]],
  ['Kokosmilch / Coconut Cream', '', COCK, [['0,4 l Dose', 'Dose', [['Karton', 12]]]]],
  ['Limetten (frisch)', '', COCK, [['1 kg', 'Kilogramm', []]]],
  ['Zitronen (frisch)', '', COCK, [['1 kg', 'Kilogramm', []]]],
  ['Minze (frisch)', '', COCK, [['1 Bund', 'Stück', []]]],
  ['Eiswürfel', '', COCK, [['2 kg Beutel', 'Beutel', []]]],
  ['Crushed Ice', '', COCK, [['2 kg Beutel', 'Beutel', []]]],
  ['Cocktailkirschen', '', COCK, [['Glas', 'Stück', []]]],
  ['Oliven (grün)', '', COCK, [['Glas', 'Stück', []]]],
  // --- Sirup ---
  ...['Vanille', 'Karamell', 'Haselnuss', 'Kokos', 'Zuckerrohr (Pure Cane)', 'Grenadine', 'Holunderblüte', 'Erdbeere', 'Mojito Mint', 'Lavendel', 'Gurke', 'Ingwer', 'Pfirsich', 'Blue Curaçao', 'Lebkuchen', 'Zimt']
    .map((s) => [`Monin Sirup ${s}`, 'Monin', SIR, [MON07]]),
  // --- Kaffee & Tee ---
  ['Espressobohnen', '', KAF, [['1 kg', 'Packung', []]]],
  ['Caffè Crema Bohnen', '', KAF, [['1 kg', 'Packung', []]]],
  ['Kaffee entkoffeiniert, Bohnen', '', KAF, [['500 g', 'Packung', []]]],
  ['Filterkaffee gemahlen', '', KAF, [['500 g', 'Packung', []]]],
  ['Teebeutel Schwarztee', '', KAF, [['100 Stk.', 'Packung', []]]],
  ['Teebeutel Pfefferminze', '', KAF, [['100 Stk.', 'Packung', []]]],
  ['Teebeutel Kamille', '', KAF, [['100 Stk.', 'Packung', []]]],
  ['Teebeutel Grüner Tee', '', KAF, [['100 Stk.', 'Packung', []]]],
  ['Teebeutel Früchtetee', '', KAF, [['100 Stk.', 'Packung', []]]],
  ['H-Milch 3,5 %', '', KAF, [['1,0 l', 'Packung', [['Karton', 12]]]]],
  ['Frischmilch 3,5 %', '', KAF, [['1,0 l', 'Packung', []]]],
  ['Hafermilch Barista', '', KAF, [['1,0 l', 'Packung', [['Karton', 6]]]]],
  ['Kaffeesahne Portionen', '', KAF, [['Packung', 'Packung', []]]],
  ['Zucker-Sticks', '', KAF, [['Karton', 'Karton', []]]],
  ['Süßstoff-Sticks', '', KAF, [['Karton', 'Karton', []]]],
  ['Kakaopulver', '', KAF, [['1 kg', 'Packung', []]]],
  ['Kaffeegebäck (Portionen)', '', KAF, [['Karton', 'Karton', []]]],
  // --- Verbrauchsmaterialien ---
  ['Servietten 33 × 33 cm, 3-lagig', '', VER, [['250 Stk.', 'Packung', [['Karton', 4]]]]],
  ['Servietten 40 × 40 cm, Airlaid', '', VER, [['50 Stk.', 'Packung', [['Karton', 12]]]]],
  ['Cocktailservietten 25 × 25 cm', '', VER, [['250 Stk.', 'Packung', []]]],
  ['Strohhalme Papier', '', VER, [['250 Stk.', 'Packung', []]]],
  ['Bierdeckel', '', VER, [['100 Stk.', 'Packung', []]]],
  ['Teelichter', '', VER, [['100 Stk.', 'Packung', []]]],
  ['Stabkerzen', '', VER, [['10 Stk.', 'Packung', []]]],
  ['Bonrollen 80 mm (Thermo)', '', VER, [['Rolle', 'Rolle', [['Karton', 50]]]]],
  ['Zahnstocher', '', VER, [['1000 Stk.', 'Packung', []]]],
  ['Cocktailspieße', '', VER, [['100 Stk.', 'Packung', []]]],
  ['Rechnungsmappen / Kellnerblocks', '', VER, [['Stück', 'Stück', []]]],
  ['Müllbeutel 120 l', '', VER, [['Rolle', 'Rolle', []]]],
  ['Einweghandschuhe Nitril', '', VER, [['100 Stk.', 'Packung', []]]],
  // --- Reinigungsmittel ---
  ['Gläserspülmittel', '', REI, [['10 l', 'Kanister', []], ['5 l', 'Kanister', []]]],
  ['Gläser-Klarspüler', '', REI, [['10 l', 'Kanister', []], ['5 l', 'Kanister', []]]],
  ['Spülmaschinen-Reiniger', '', REI, [['10 l', 'Kanister', []]]],
  ['Glasreiniger', '', REI, [['1,0 l', 'Flasche', [['Karton', 6]]]]],
  ['Flächendesinfektion', '', REI, [['1,0 l', 'Flasche', [['Karton', 6]]]]],
  ['Edelstahlpflege', '', REI, [['0,5 l', 'Flasche', []]]],
  ['Handspülmittel', '', REI, [['1,0 l', 'Flasche', []], ['5 l', 'Kanister', []]]],
  ['Bierglasspülmittel', '', REI, [['1,0 l', 'Flasche', []]]],
  ['Regeneriersalz', '', REI, [['25 kg', 'Beutel', []]]],
];

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[’'´`]/g, "'");

/** Alle Einträge als flache Liste (eine Zeile je Größe). */
export const CATALOG = RAW.flatMap(([name, maker, category, variants]) => variants.map(([size, unit, orders]) => ({
  name: /^(\d|Glas$|Packung$|Karton$|Stück$|Rolle$|1 Bund)/.test(size) && !/^\d/.test(size) ? name : `${name} ${size}`,
  base: name, maker, category, size, unit,
  orders: orders.map(([u, n]) => ({ unit: u, per: n })),
})));

/** Suche: alle Wörter müssen vorkommen; Treffer am Wortanfang zuerst. */
export function searchCatalog(q, limit = 8) {
  const words = norm(q).split(/\s+/).filter(Boolean);
  if (!words.length || norm(q).length < 2) return [];
  return CATALOG
    .map((e) => {
      const h = norm(`${e.name} ${e.maker} ${e.category}`);
      if (!words.every((w) => h.includes(w))) return null;
      const score = (norm(e.name).startsWith(words[0]) ? 0 : 10) + (new RegExp(`\\b${words[0].replace(/[^a-z0-9]/g, '')}`).test(norm(e.name)) ? 0 : 5) + e.name.length / 100;
      return { e, score };
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((x) => x.e);
}

/** Text wie „Flasche · Kasten à 24“ */
export function describe(e) {
  return [e.unit, ...e.orders.map((o) => `${o.unit} à ${o.per}`)].join(' · ');
}

/** Häufige Bestelleinheiten für Artikel außerhalb des Katalogs. */
export const COMMON_ORDERS = [
  { unit: 'Kasten', per: 24 }, { unit: 'Kasten', per: 20 }, { unit: 'Kasten', per: 12 },
  { unit: 'Karton', per: 6 }, { unit: 'Karton', per: 12 }, { unit: 'Karton', per: 24 },
];
