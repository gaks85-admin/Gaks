async function testSymbol(symbol) {
  const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=demo`;
  const res = await fetch(url);
  const data = await res.json();
  console.log(`${symbol} ->`, data);
}
async function run() {
  await testSymbol('EURUSD');
}
run();
