/**
 * Message Formatter Service
 *
 * Formats WhatsApp messages using templates and TwiML
 * TDD implementation per ADR-014
 */

export type TemplateName =
  | 'WELCOME_FIRST_TIME'
  | 'OTP_REQUEST'
  | 'OTP_VERIFICATION_SUCCESS'
  | 'JOURNEY_WHEN'
  | 'JOURNEY_STATIONS'
  | 'JOURNEY_TIME'
  | 'JOURNEY_CONFIRMATION'
  | 'TICKET_REQUEST'
  | 'ERROR_INVALID_INPUT'
  | 'ERROR_TIMEOUT';

const TEMPLATES: Record<TemplateName, string> = {
  WELCOME_FIRST_TIME: `Welcome to RailRepay! 🚂

I help you claim compensation for delayed trains automatically.

To get started, I need to verify your phone number. Reply YES to receive a verification code, or TERMS to read our terms of service first.`,

  OTP_REQUEST: `Your RailRepay verification code is: {{code}}

This code expires in 5 minutes. Do not share it with anyone.`,

  OTP_VERIFICATION_SUCCESS: `✅ Phone verified successfully!

You're all set to start claiming. When did your delayed journey happen?

Reply with a date like "today", "yesterday", or "15 Nov"`,

  JOURNEY_WHEN: `When did your delayed journey happen?

Reply with a date like:
• "today"
• "yesterday"
• "15 Nov"
• "2024-11-15"`,

  JOURNEY_STATIONS: `Where did you travel from and to?

Reply with your stations, e.g.:
• "Kings Cross to Edinburgh"
• "Manchester to London"`,

  JOURNEY_TIME: `What time was your train scheduled to depart?

Reply with the time, e.g.:
• "14:30"
• "2:30pm"
• "quarter past 2"`,

  JOURNEY_CONFIRMATION: `Please confirm your journey details:

📅 Date: {{date}}
🚉 From: {{from}}
🚉 To: {{to}}
🕐 Time: {{time}}

Reply YES to confirm or NO to start again.`,

  TICKET_REQUEST: `Great! Now I need a photo of your ticket or booking confirmation.

Please send an image showing:
• Your journey details
• The date of travel
• Your name (if shown)`,

  ERROR_INVALID_INPUT: `Sorry, I didn't understand that. {{hint}}

Please try again or reply HELP for assistance.`,

  ERROR_TIMEOUT: `Your session has expired due to inactivity.

Reply with any message to start a new conversation.`,
};

export class MessageFormatterService {
  /**
   * Format message body as TwiML XML
   * Escapes special XML characters and wraps in TwiML structure
   *
   * @param body - Plain text message body
   * @returns TwiML XML string
   */
  formatTwiML(body: string): string {
    const escapedBody = this.escapeXml(body);

    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Message><Body>${escapedBody}</Body></Message>
</Response>`;
  }

  /**
   * Get message template with variable substitution
   *
   * @param templateName - Name of the template
   * @param variables - Optional key-value pairs for variable substitution
   * @returns Template string with variables replaced
   * @throws Error if template name is unknown
   */
  getTemplate(templateName: TemplateName, variables?: Record<string, string>): string {
    const template = TEMPLATES[templateName];

    if (!template) {
      throw new Error(`Unknown template: ${templateName}`);
    }

    // No variables provided, return template as-is
    if (!variables) {
      return template;
    }

    // Replace all variable placeholders
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      // Replace all occurrences of the placeholder
      result = result.split(placeholder).join(value);
    }

    return result;
  }

  /**
   * Escape special XML characters
   * Prevents XML injection and ensures valid TwiML
   *
   * @param text - Text to escape
   * @returns Escaped text safe for XML
   */
  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
