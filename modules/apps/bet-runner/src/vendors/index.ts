import { betanoDriver } from "./betano.js";
import type { BookmakerDriver } from "./types.js";

// The registry the poller consults after claiming a job: the BFF
// resolves the vendor from the link's hostname (bet-api's vendors.ts),
// this file just maps the vendor name to its driver. Supporting a new
// house = a new driver file here + one entry in this list + a hostname
// entry in the BFF — nothing else changes anywhere.
const DRIVERS: BookmakerDriver[] = [betanoDriver];

export function resolveDriver(vendor: string): BookmakerDriver | null {
  return DRIVERS.find((driver) => driver.vendor === vendor) ?? null;
}

export function supportedVendors(): string[] {
  return DRIVERS.map((driver) => driver.vendor);
}