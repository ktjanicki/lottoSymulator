import { simulation } from './simulation.js';

onmessage = ({ data }) => {
  postMessage(simulation(data));
};
