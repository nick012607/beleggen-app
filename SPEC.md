# Beleggingsdashboard met dagelijkse krant – projectspecificatie

Je bouwt voor mij (Nick, solo developer) een persoonlijke beleggingsapp. Lees dit hele document eerst. Stel daarna je vragen en geef een kort bouwplan voordat je code schrijft.

## Werkwijze (belangrijk)
- Werk in fases (zie onderaan). Begin pas aan de volgende fase als ik de vorige heb goedgekeurd.
- Voer alle wijzigingen zelf door in de bestanden. Laat mij niets kopiëren of plakken.
- Houd je voortgang expliciet zichtbaar. Zeg bij elke stap wat je doet, en sluit elke fase af met:
  1. wat er gebouwd is (lijst met bestanden),
  2. wat getest is en of het gelukt is,
  3. wat ik zelf moet doen (bijvoorbeeld een API-sleutel aanmaken of een SQL-script draaien in Supabase), stap voor stap,
  4. hoe ik het kan uitproberen.
- Loop je vast of twijfel je tussen opties, vraag het dan in plaats van te gokken.
- Commit per afgeronde stap met een duidelijke commitmessage.

## Doel
Een webapp waarin ik mijn beleggingen bijhoud en die elke ochtend een korte "krant" schrijft: wat er gebeurd is met mijn beleggingen en waarom. De app is bedoeld om geïnformeerd te blijven, niet als koop- of verkoopadvies.

## Stack
- **Frontend:** vanilla JavaScript, HTML en CSS (geen framework), gehost op GitHub Pages en installeerbaar als PWA.
- **Database en authenticatie:** Supabase. Er is maar één gebruiker (ik), met login via magic link. Row Level Security staat aan op alle tabellen.
- **Backend en automatisering:** een Cloudflare Worker met cron-triggers.
- **AI:** de Claude API met model `claude-sonnet-5-5`, en web search met een beperkt aantal zoekopdrachten.
- **Geheimen:** alle API-sleutels (Claude, koersdata, Supabase service key) staan uitsluitend als Worker-secrets. Er komen nooit sleutels in de frontend of in git. Voeg een `.gitignore` en een `.dev.vars.example` toe.

## Mijn portefeuille (context)
Ik beleg vooral via ETF's: een S&P 500-indexfonds, een Nasdaq-100-ETF, en thematische posities in uranium/nucleair, quantum computing en elektrificatie. Mijn broker is DEGIRO. De meeste van mijn ETF's zijn waarschijnlijk Europese (UCITS) noteringen, bijvoorbeeld op Euronext of Xetra.

## Functies

### 1. Portefeuille via CSV-import
- Er is **geen** directe DEGIRO-koppeling. Ik exporteer mijn portefeuille en/of transacties als CSV uit DEGIRO en sleep dat bestand in de app.
- Bouw een parser die tegen variatie kan: kolomnamen in het Nederlands of Engels, komma of punt als decimaalteken, en verschillende valuta. Ik lever een voorbeeld-CSV aan. Vraag daarom bij de start om dat bestand.
- Toon vóór het opslaan een preview van wat er geïmporteerd wordt. Een nieuwe import vervangt de posities (of voegt nieuwe transacties toe, zonder dubbelingen).
- Ik kan posities ook handmatig toevoegen of aanpassen.
- **Beleggingsdagboek:** per positie een notitie met waarom ik de positie kocht.
- **ETF-context:** per ETF sla je het thema en de belangrijkste onderliggende bedrijven op. Die mag Claude één keer voorstellen via web search, waarna ik ze kan aanpassen.

### 2. Dashboard
- Totale waarde, rendement per positie en in totaal (in euro en in procent), en een grafiek van het verloop.
- Spreiding per sector, regio en valuta, met een waarschuwing bij te veel concentratie of overlap (bijvoorbeeld tussen de S&P 500- en de Nasdaq-100-ETF).
- Een vergelijking met een wereldindex-ETF (MSCI World) als benchmark.
- Een watchlist: aandelen of ETF's die ik volg zonder ze te bezitten. Per item kan ik een koersgrens instellen voor een melding.

### 3. Dagelijkse krant (het hart van de app)
De krant wordt elke werkdag rond 07:00 Nederlandse tijd gemaakt door de Worker, opgeslagen in Supabase en getoond als een nette krantenpagina. De taal is Nederlands. De onderdelen zijn:
- **Openingskop:** het belangrijkste verhaal van de dag voor mijn portefeuille.
- **Bewegingen:** een artikel per opvallende beweging (drempel instelbaar, bijvoorbeeld meer dan 2%) en per grote positie. Elk artikel beschrijft wat er gebeurde, de meest waarschijnlijke reden, en de context tegenover de markt en de sector. Het vermeldt altijd de bronnen, en zegt eerlijk wanneer de oorzaak onduidelijk is. Bij ETF's gaat het artikel over de onderliggende bedrijven of het thema, niet alleen over de ETF zelf.
- **Thema's:** kort nieuws per thema (uranium/nucleair, quantum, elektrificatie).
- **Agenda:** kwartaalcijfers, dividenddatums en rentebesluiten (ECB en Fed) die mijn posities raken, voor vandaag en deze week.
- **Watchlist:** belangrijke bewegingen of nieuws bij de items op mijn watchlist, en items die door hun koersgrens zijn gegaan.
- **Dagboek-check:** geeft aan wanneer het nieuws de reden raakt waarom ik iets kocht.
- **Archief:** alle eerdere edities blijven terug te lezen.

Regels voor de Claude-prompt in de Worker:
- Claude geeft geen koop- of verkoopadvies. Het informeert en duidt alleen.
- Claude verzint geen oorzaken. Bij twijfel staat er dat de oorzaak onduidelijk is.
- De output is gestructureerde JSON (koppen, artikelen, bronnen). De frontend rendert die JSON.

### 4. Weekeditie
Op zondag verschijnt een langere editie met de beste en slechtste presteerders, mijn rendement tegenover de benchmark, en de belangrijkste thema's van de week.

### 5. Meldingen
Een web-pushmelding als de krant klaarstaat, en een melding bij watchlist-grenzen. Houd er rekening mee dat iOS alleen push toestaat als de PWA op het beginscherm is gezet.

## Databronnen
- Onderzoek eerst welke **gratis** bron betrouwbare dagkoersen levert voor zowel Amerikaanse aandelen als **Europese ETF-noteringen** (Euronext/Xetra). Finnhub gratis dekt waarschijnlijk alleen de VS. Leg me 2–3 opties voor, met hun beperkingen, voordat je er een kiest.
- Voor nieuws: Finnhub company news voor Amerikaanse tickers, aangevuld met Claude web search.
- Voor valuta: omrekening naar euro met dagkoersen.

## Kosten (harde eis)
Mijn doel is maximaal ongeveer $8 per maand aan Claude API-kosten.
- Eén Claude-aanroep per editie, en niet één per aandeel.
- Beperk web search via `max_uses` (bijvoorbeeld 10 zoekopdrachten per editie).
- Stuur Claude een compacte samenvatting van koersen en nieuwskoppen, geen volledige artikelen.
- Gebruik prompt caching voor de vaste systeemprompt.
- Log per run het tokenverbruik en de geschatte kosten in Supabase, en toon het maandtotaal op een instellingenpagina.
- Bouw een beveiliging in: als een run mislukt, probeer het maximaal één keer opnieuw, en geen oneindige lussen.

## Fases
1. **Fundament:** de repostructuur, het Supabase-schema met RLS, de login, de CSV-import (met mijn voorbeeld-CSV), handmatige posities en het dagboek.
2. **Dashboard:** de koersbron, waarde en rendement, de grafiek, spreiding en overlap, de benchmark en de watchlist.
3. **Dagelijkse krant:** de Worker met cron, de Claude-integratie met kostenlogging, de krantweergave en het archief. Voeg ook een knop "maak nu een editie" toe om te testen.
4. **Uitbreidingen:** de weekeditie, de agenda, pushmeldingen en de PWA-installatie.

Begin met: je vragen, je voorstel voor de koersbron, en het bouwplan voor fase 1.
