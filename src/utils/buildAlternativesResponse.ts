/**
 * Route Formatter Utility
 *
 * Shared utility for formatting alternative routes for WhatsApp display.
 * Extracted from routing-alternative.handler.ts to enable reuse across handlers.
 *
 * TD-WHATSAPP-056 AC-5: Importable by both journey-confirm and routing-alternative handlers
 */

/**
 * Build response message from route alternatives
 *
 * @param routes - Array of route objects from journey-matcher API
 * @returns Formatted string with numbered options and call to action
 */
export function buildAlternativesResponse(routes: any[]): string {
  let response = `Here are alternative routes for your journey:\n`;

  routes.forEach((route, index) => {
    const optionNumber = index + 1;
    const legs = route.legs || [];

    // Build route summary (A → B → C)
    const stationPath = legs.map((leg: any) => leg.from).concat(legs[legs.length - 1]?.to || []).join(' → ');

    response += `\n${optionNumber}. ${stationPath}\n`;

    // Add leg details (indented with 3 spaces)
    legs.forEach((leg: any, legIndex: number) => {
      response += `   Leg ${legIndex + 1}: ${leg.from} → ${leg.to} (${leg.operator}, ${leg.departure}-${leg.arrival})\n`;
    });

    response += `   Total: ${route.totalDuration}\n`;
  });

  response += `\nReply with 1, 2, or 3 to select a route, or NONE if none of these match your journey.`;

  return response;
}
