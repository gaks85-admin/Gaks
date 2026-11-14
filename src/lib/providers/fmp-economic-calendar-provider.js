import { getCurrencyForCountry } from "../utils/currency-mapping.js";
class FmpEconomicCalendarProvider {
  apiKey;
  baseUrl = "https://financialmodelingprep.com/stable";
  constructor() {
    const key = process.env.FMP_API_KEY;
    if (!key) {
      console.warn("FMP_API_KEY not found in environment variables. FMP provider will not function correctly.");
    }
    this.apiKey = key || "";
  }
  async getUpcomingEvents(from, to) {
    return this.fetchEvents(from, to);
  }
  async getRecentEvents(from, to) {
    return this.fetchEvents(from, to);
  }
  async fetchEvents(from, to) {
    if (!this.apiKey) {
      return [];
    }
    try {
      const url = `${this.baseUrl}/economic-calendar?from=${from}&to=${to}&apikey=${this.apiKey}`;
      const response = await fetch(url);
      if (!response.ok) {
        if (response.status === 402) {
          console.error("FMP API error: 402 Payment Required. Your FMP subscription does not include the Economic Calendar.");
          return [];
        }
        throw new Error(`FMP API error: ${response.status} ${response.statusText}`);
      }
      const data = await response.json();
      return data.map((event) => this.normalizeEvent(event));
    } catch (error) {
      console.error("Error fetching economic events from FMP:", error);
      return [];
    }
  }
  normalizeEvent(fmpEvent) {
    const scheduledAt = fmpEvent.date.includes(" ") ? fmpEvent.date.replace(" ", "T") + "Z" : fmpEvent.date;
    const currency = getCurrencyForCountry(fmpEvent.country);
    const now = /* @__PURE__ */ new Date();
    const eventTime = new Date(scheduledAt);
    const isPast = eventTime < now;
    const hasActual = fmpEvent.actual !== null && fmpEvent.actual !== void 0;
    const status = isPast || hasActual ? "RELEASED" : "UPCOMING";
    let impact = "LOW";
    const rawImpact = fmpEvent.impact.toUpperCase();
    if (rawImpact.includes("HIGH")) impact = "HIGH";
    else if (rawImpact.includes("MEDIUM")) impact = "MEDIUM";
    const providerEventId = btoa(`${fmpEvent.event}-${fmpEvent.date}-${fmpEvent.country}`).substring(0, 32);
    return {
      providerEventId,
      eventName: fmpEvent.event,
      country: fmpEvent.country,
      currency,
      impact,
      scheduledAt,
      actual: fmpEvent.actual,
      forecast: fmpEvent.forecast,
      previous: fmpEvent.previous,
      unit: null,
      // FMP doesn't provide a clean unit field in this endpoint
      status
    };
  }
}
export {
  FmpEconomicCalendarProvider
};
