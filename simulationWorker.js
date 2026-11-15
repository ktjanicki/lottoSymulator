import { generator } from './generator.js';
import { simulation } from './simulation.js';

// Wiadomość od strony: {mode: 'simulator', game, numbers} — identyfikator
// z GAMES i kupon płasko — albo {mode: 'generator', game, draws}.
// Wiadomości do strony: {type: 'progress'} w trakcie, {type: 'result'} na końcu,
// {type: 'error'} zamiast wyniku, gdy liczenie rzuci (np. zły kupon, nieznana
// gra albo tryb, brak pamięci na liczniki generatora). Bez tej ostatniej
// strona czekałaby na wynik bez końca z kręcącym się spinnerem.
// Przerwanie to worker.terminate() po stronie strony — pętla jest synchroniczna,
// więc worker i tak nie odebrałby w jej trakcie żadnej wiadomości.
const MODES = {
  simulator: ({ game, numbers }, options) => simulation(game, numbers, Math.random, options),
  generator: ({ game, draws }, options) => generator(game, draws, Math.random, options),
};

onmessage = ({ data }) => {
  try {
    // Object.hasOwn, nie `in`: „toString” przeszedłby jako tryb.
    if (!Object.hasOwn(MODES, data?.mode)) {
      throw new RangeError(`Nieznany tryb: ${data?.mode}. Znane tryby: ${Object.keys(MODES).join(', ')}.`);
    }
    const result = MODES[data.mode](data, {
      onProgress: (progress) => postMessage({ type: 'progress', ...progress }),
    });
    postMessage({ type: 'result', ...result });
  } catch (error) {
    postMessage({ type: 'error', message: String(error?.message ?? error) });
  }
};
