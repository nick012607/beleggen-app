// Nepdata in exact het DEGIRO-formaat (geen echte portefeuille).

export const PORTFOLIO_NL = `Product,Symbool/ISIN,Aantal,Slotkoers,Lokale waarde,,Waarde in EUR
CASH & CASH FUND & FTX CASH (EUR),,,,EUR,"10,50","10,50"
INVESCO EQQQ NASDAQ-100 UCITS ET...,IE00BFZXGZ54,2,"400,00",EUR,"800,00","800,00"
VANGUARD S&P 500 UCITS ETF USD ACC,IE00BFMXXD54,10,"100,00",EUR,"1000,00","1000,00"
APPLE INC,US0378331005,3,"200,00",USD,"600,00","552,00"
`;

export const TRANSACTIONS_NL = `Datum,Tijd,Product,ISIN,Beurs,Uitvoeringsplaats,Aantal,Koers,,Lokale waarde,,Waarde EUR,Wisselkoers,AutoFX Kosten,Transactiekosten en/of kosten van derden EUR,Totaal EUR,Order ID
02-06-2026,09:00,VANGUARD S&P 500 UCITS ETF USD ACC,IE00BFMXXD54,TDG,XGAT,4,"110,0000",EUR,"-440,00",EUR,"-440,00",,"0,00","-1,00","-441,00",bbbb-2222
01-05-2026,10:15,VANGUARD S&P 500 UCITS ETF USD ACC,IE00BFMXXD54,TDG,XGAT,6,"100,0000",EUR,"-600,00",EUR,"-600,00",,"0,00","-1,00","-601,00",aaaa-1111
01-05-2026,10:20,INVESCO EQQQ NASDAQ-100 UCITS ETF ACC,IE00BFZXGZ54,TDG,XGAT,2,"400,0000",EUR,"-800,00",EUR,"-800,00",,"0,00","-1,00","-801,00",cccc-3333
`;

// Deeluitvoering: zelfde Order ID, andere aantallen -> géén dubbeling
export const TRANSACTIONS_PARTIAL_FILL = `Datum,Tijd,Product,ISIN,Beurs,Uitvoeringsplaats,Aantal,Koers,,Lokale waarde,,Waarde EUR,Wisselkoers,AutoFX Kosten,Transactiekosten en/of kosten van derden EUR,Totaal EUR,Order ID
03-06-2026,09:00,VANGUARD S&P 500 UCITS ETF USD ACC,IE00BFMXXD54,TDG,XGAT,1,"110,0000",EUR,"-110,00",EUR,"-110,00",,"0,00","-1,00","-111,00",dddd-4444
03-06-2026,09:00,VANGUARD S&P 500 UCITS ETF USD ACC,IE00BFMXXD54,TDG,XGAT,2,"110,0000",EUR,"-220,00",EUR,"-220,00",,"0,00","0,00","-220,00",dddd-4444
`;

// Verkoop + USD-aandeel met AutoFX, Engelse kolomnamen, punt als decimaalteken, duizendtallen
export const TRANSACTIONS_EN = `Date,Time,Product,ISIN,Reference exchange,Venue,Quantity,Price,,Local value,,Value,Exchange rate,AutoFX Fee,Transaction and/or third party fees EUR,Total EUR,Order ID
10-03-2026,15:45,APPLE INC,US0378331005,NDQ,XNAS,5,200.00,USD,-1000.00,USD,-920.00,1.0870,-2.30,-1.00,-923.30,eeee-5555
20-03-2026,16:00,APPLE INC,US0378331005,NDQ,XNAS,-2,210.00,USD,420.00,USD,386.40,1.0869,-0.97,-1.00,384.43,ffff-6666
21-03-2026,16:00,BIG CO,US0000000001,NDQ,XNAS,1,"1,234.50",USD,"-1,234.50",USD,"-1,135.74",1.0870,-2.84,-1.00,"-1,139.58",gggg-7777
`;

// Puntkomma als scheidingsteken (Excel-NL), punt als duizendtal
export const PORTFOLIO_SEMICOLON = `Product;Symbool/ISIN;Aantal;Slotkoers;Lokale waarde;;Waarde in EUR
VANGUARD S&P 500 UCITS ETF USD ACC;IE00BFMXXD54;10;100,00;EUR;1.000,00;1.000,00
`;
