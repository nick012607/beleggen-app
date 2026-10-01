// ECB-referentiekoersen via Frankfurter (gratis, geen sleutel). Koersen zijn "1 EUR = x valuta".

/** Geeft functie (currency, date) -> aantal valuta per euro, met terugval op de laatst bekende eerdere koers. */
export async function loadFx(ctx, currencies, fromDate) {
  const list = [...new Set(currencies.filter(c => c && c !== 'EUR'))];
  if (!list.length) return () => 1;
  ctx.budget.use();
  const start = fromDate.toISOString().slice(0, 10);
  const res = await fetch(`https://api.frankfurter.dev/v1/${start}..?from=EUR&to=${list.join(',')}`);
  if (!res.ok) throw new Error(`Wisselkoersen niet beschikbaar (${res.status})`);
  const data = await res.json();
  const dates = Object.keys(data.rates).sort();
  return (currency, date) => {
    if (currency === 'EUR') return 1;
    // laatste koersdatum <= date
    let lo = 0, hi = dates.length - 1, found = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (dates[mid] <= date) { found = dates[mid]; lo = mid + 1; } else hi = mid - 1;
    }
    const rate = data.rates[found ?? dates[0]]?.[currency];
    if (!rate) throw new Error(`Geen wisselkoers voor ${currency}`);
    return rate;
  };
}
