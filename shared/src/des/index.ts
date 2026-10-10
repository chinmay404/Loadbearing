// The request engine. Only the entry point and its result types are public; the
// heap, random numbers and histograms are its own business.
export { runDes, type DesOptions, type DesPart, type DesResult, type DesTick } from './engine.js';
