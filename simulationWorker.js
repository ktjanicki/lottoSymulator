import { simulation } from './simulation.js';

// Wiadomości do strony: {type: 'progress'} w trakcie, {type: 'result'} na końcu,
// {type: 'error'} zamiast wyniku, gdy symulacja rzuci (np. zły kupon). Bez tej
// ostatniej strona czekałaby na wynik bez końca z kręcącym się spinnerem.
// Przerwanie to worker.terminate() po stronie strony — pętla jest synchroniczna,
// więc worker i tak nie odebrałby w jej trakcie żadnej wiadomości.
onmessage = ({ data }) => {
  try {
    const result = simulation(data, Math.random, {
      onProgress: (progress) => postMessage({ type: 'progress', ...progress }),
    });
    postMessage({ type: 'result', ...result });
  } catch (error) {
    postMessage({ type: 'error', message: String(error?.message ?? error) });
  }
};
