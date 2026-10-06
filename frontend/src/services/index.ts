import { ApiBackend } from "./api";
import type { Services } from "./types";

/**
 * Single entry point for every backend call in the app.
 *
 * The UI talks to the FastAPI backend through this adapter. The mock remains
 * available for isolated service tests, but is no longer used by the app.
 */
export const services: Services = new ApiBackend();

export * from "./types";
