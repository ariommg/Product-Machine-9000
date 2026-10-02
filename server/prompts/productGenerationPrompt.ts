import type { ExtractedProductData } from "../../src/types/product.js";

/**
 * Wording that reveals how the product is sourced. It must never appear in
 * customer-facing copy. Word boundaries matter here: "kina" would otherwise
 * match the perfectly ordinary product word "kinakål".
 */
export const forbiddenCustomerTerms = [
  /\balibaba\b/i,
  /\bleverant[oö]r(en|er|erna)?\b/i,
  /\bsupplier\b/i,
  /\bvendor\b/i,
  /\bfabrik(en|er)?\b/i,
  /\bfactory\b/i,
  /\bchina\b/i,
  /\bkina\b/i,
  /\bkinesisk[at]?\b/i,
  /\bdropshipping\b/i,
  /\bmellanhand\b/i,
  /\bmiddleman\b/i,
  /\breseller\b/i,
  /\b[aå]terf[oö]rs[aä]ljare\b/i,
  /enligt leverant[oö]r/i,
  /according to supplier/i,
  /\bMOQ\b/,
  /minsta best[aä]llning/i,
  /\bgrossist\b/i,
  /\bwholesale\b/i,
];

/**
 * Only product facts are sent to the model. Supplier identity, prices, MOQ, and
 * logistics are withheld entirely rather than being sent with instructions not
 * to use them, which is the more reliable way to keep them out of the output.
 */
const customerSafeProductFacts = (product: ExtractedProductData) => ({
  extractedDescription: product.description,
  extractedTitle: product.title,
  specifications: product.specifications.map((specification) => ({
    name: specification.name,
    value: specification.value,
  })),
  variantOptions: product.variantOptions.map((option) => ({
    id: option.id,
    name: option.name,
    values: option.values.map((value) => ({
      id: value.id,
      name: value.name,
      ...(value.hexColor ? { hexColor: value.hexColor } : {}),
    })),
  })),
});

const variantSection = (product: ExtractedProductData) =>
  product.variantOptions.length === 0
    ? `
VARIANTER
Produkten har inga varianter. Returnera en tom lista för options.`
    : `
VARIANTER
Produkten säljs i varianter, listade under variantOptions. Returnera i options ett
svenskt namn för varje grupp och för varje värde, med exakt samma id som i datan.
- Gruppnamn ska vara korta och vanliga i svensk e-handel, till exempel "Färg",
  "Storlek" eller "Modell". Välj efter vad värdena faktiskt beskriver, inte efter
  leverantörens gruppnamn: en grupp som heter "color" men innehåller mått är en storlek.
- Värdenamn ska vara korta, högst fyra ord, och unika inom sin grupp.
- När ett värde har en bild (se bilderna efter den här texten) är bilden facit.
  Är leverantörens namn meningslöst, till exempel en siffra eller en kod, beskriv
  det som syns: färg och eventuellt mönster eller motiv.
- Mått, storlekar och enheter behålls exakt. Översätt bara orden runt dem.
- Ta bort säljfraser och instruktioner till köparen ur namnen.
- Hittar du inget rimligt namn, behåll leverantörens namn och lägg till en rad i needsReview.`;

/** Lines that introduce each swatch picture sent alongside the prompt. */
export const swatchCaption = (optionName: string, valueId: string, valueName: string) =>
  `Bild för värde id ${valueId} i gruppen "${optionName}" (leverantörens namn: "${valueName}"):`;

export const buildProductGenerationPrompt = (product: ExtractedProductData) => `
Du skriver produkttexter för en svensk e-handelsbutik.

UPPGIFT
Omvandla rådata från en produktsida till färdig svensk produkttext.
Generera endast: titel, beskrivning, rensade specifikationer och svenska namn på varianter.
Generera inte SEO-fält, taggar, kategori, nya varianter, priser eller bildprompter.

SPRÅK
All output ska vara på svenska, oavsett vilket språk källdatan är på.
Skriv naturlig, korrekt svenska med normal ordföljd och normal interpunktion.

PRODUKTTYP
Produkten kan vara vad som helst: kök, hem, trädgård, verktyg, textil, förvaring,
sport, barn, husdjur, elektronik eller något annat. Utgå enbart från datan du får.
Anta aldrig en produktkategori som datan inte stödjer.

TITEL
- En tydlig, naturlig produkttitel som en svensk e-handel skulle använda.
- Beskriv vad produkten är, följt av det viktigaste särdraget (till exempel material).
- Sikta på 40-65 tecken.
- Ingen nyckelordsstuffing, inga upprepade synonymer, inga konstiga snedstreck.
  Skriv "Rivjärn i rostfritt stål", inte "Zester-/finrivjärn rivjärn rostfri stål".
- Ingen butiksnamn, inga utropstecken, inga versaler för betoning.

BESKRIVNING
- 2-3 stycken, totalt ungefär 60-120 ord.
- Separera stycken med en tom rad. Skriv ren löptext utan markdown, HTML,
  punktlistor eller rubriker.
- Upprepa inte titeln ordagrant som första mening.
- Fokusera på vad produkten gör för kunden: användning, hantering, känsla, kvalitet.
- Översätt tekniska förkortningar till begriplig kundtext.
  Skriv "ett greppvänligt handtag som ligger stadigt i handen", inte "handtag i PP+TPR".
- Exakta mått och tekniska värden hör hemma i specifikationerna, inte i beskrivningen.
- Inga överdrifter. Skriv inte "premium", "bäst i test" eller liknande utan täckning
  i datan. Inga medicinska påståenden, säkerhetspåståenden eller certifieringar
  som inte finns i källdatan.

SPECIFIKATIONER
- Ta med de rader som beskriver själva produkten: mått, längd, diameter, material,
  vikt, volym, kapacitet, färg, antal i förpackningen.
- Använd svenska fältnamn och konsekventa enheter.
- Sätt confidence "high" när värdet står tydligt i källdatan, "medium" när det är
  omformulerat, "low" när det är osäkert.
- Hoppa över rader som är tomma, "N/A", "customized" eller liknande platshållare.
- Varianternas värden, som färger och storlekar, hör hemma i options, inte i specifikationerna.
${variantSection(product)}

TON
Skriv som en etablerad svensk butik som säljer produkten själv.
Neutral, saklig, hjälpsam. Ingen marknadsföringsjargong.

ABSOLUTA REGLER
- Hitta aldrig på mått, material, vikt, volym, kapacitet, certifieringar eller
  prestandapåståenden. Saknas data ska fältet utelämnas.
- Nämn aldrig hur produkten köps in eller varifrån den kommer.
- Osäkerheter hör hemma i needsReview, aldrig i titel, beskrivning eller specifikationer.
- needsReview skrivs på svenska och beskriver konkret vad som behöver kontrolleras.

PRODUKTDATA
${JSON.stringify(customerSafeProductFacts(product), null, 2)}
`;
