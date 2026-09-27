import { simulation } from './simulation.js';

// Wiadomości do strony: {type: 'progress'} w trakcie, {type: 'result'} na końcu.
// Przerwanie to worker.terminate() po stronie strony — pętla jest synchroniczna,
// więc worker i tak nie odebrałby w jej trakcie żadnej wiadomości.
onmessage = ({ data }) => {
  const result = simulation(data, Math.random, {
    onProgress: (progress) => postMessage({ type: 'progress', ...progress }),
  });
  postMessage({ type: 'result', ...result });
};
