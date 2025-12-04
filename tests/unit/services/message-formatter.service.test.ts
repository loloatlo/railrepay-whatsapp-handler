/**
 * Message Formatter Service Unit Tests
 *
 * TDD Phase: FAILING TESTS FIRST
 * Following ADR-014 testing strategy
 */

import { describe, it, expect } from 'vitest';
import { MessageFormatterService, TemplateName } from '../../../src/services/message-formatter.service';

describe('MessageFormatterService', () => {
  let service: MessageFormatterService;

  beforeEach(() => {
    service = new MessageFormatterService();
  });

  describe('formatTwiML', () => {
    it('should wrap plain text in valid TwiML', () => {
      const body = 'Hello, World!';
      const result = service.formatTwiML(body);

      expect(result).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(result).toContain('<Response>');
      expect(result).toContain('<Message>');
      expect(result).toContain('<Body>Hello, World!</Body>');
      expect(result).toContain('</Message>');
      expect(result).toContain('</Response>');
    });

    it('should escape special XML characters', () => {
      const testCases = [
        { input: 'Price: £50 & up', expected: 'Price: £50 &amp; up' },
        { input: 'Less < More', expected: 'Less &lt; More' },
        { input: 'Greater > Less', expected: 'Greater &gt; Less' },
        { input: 'Quote "this"', expected: 'Quote &quot;this&quot;' },
        { input: "Apostrophe 'this'", expected: "Apostrophe &apos;this&apos;" },
      ];

      for (const { input, expected } of testCases) {
        const result = service.formatTwiML(input);
        expect(result).toContain(`<Body>${expected}</Body>`);
      }
    });

    it('should handle empty string', () => {
      const result = service.formatTwiML('');
      expect(result).toContain('<Body></Body>');
    });

    it('should handle multiline text', () => {
      const body = 'Line 1\nLine 2\nLine 3';
      const result = service.formatTwiML(body);

      expect(result).toContain('<Body>Line 1\nLine 2\nLine 3</Body>');
    });

    it('should escape all special characters together', () => {
      const body = '<tag>&"value"</tag>';
      const result = service.formatTwiML(body);

      expect(result).toContain('&lt;tag&gt;&amp;&quot;value&quot;&lt;/tag&gt;');
    });
  });

  describe('getTemplate', () => {
    it('should return WELCOME_FIRST_TIME template', () => {
      const result = service.getTemplate('WELCOME_FIRST_TIME');

      expect(result).toContain('Welcome to RailRepay');
      expect(result).toContain('verify your phone number');
      expect(result).toContain('Reply YES');
    });

    it('should return OTP_REQUEST template with code variable', () => {
      const result = service.getTemplate('OTP_REQUEST', { code: '123456' });

      expect(result).toContain('Your RailRepay verification code is: 123456');
      expect(result).toContain('expires in 5 minutes');
      expect(result).not.toContain('{{code}}');
    });

    it('should return OTP_VERIFICATION_SUCCESS template', () => {
      const result = service.getTemplate('OTP_VERIFICATION_SUCCESS');

      expect(result).toContain('Phone verified successfully');
      expect(result).toContain('When did your delayed journey happen');
    });

    it('should return JOURNEY_WHEN template', () => {
      const result = service.getTemplate('JOURNEY_WHEN');

      expect(result).toContain('When did your delayed journey happen');
      expect(result).toContain('today');
      expect(result).toContain('yesterday');
    });

    it('should return JOURNEY_STATIONS template', () => {
      const result = service.getTemplate('JOURNEY_STATIONS');

      expect(result).toContain('Where did you travel from and to');
      expect(result).toContain('Kings Cross to Edinburgh');
    });

    it('should return JOURNEY_TIME template', () => {
      const result = service.getTemplate('JOURNEY_TIME');

      expect(result).toContain('What time was your train scheduled to depart');
      expect(result).toContain('14:30');
    });

    it('should return JOURNEY_CONFIRMATION template with all variables', () => {
      const variables = {
        date: '15 Nov 2024',
        from: 'Kings Cross',
        to: 'Edinburgh',
        time: '14:30',
      };

      const result = service.getTemplate('JOURNEY_CONFIRMATION', variables);

      expect(result).toContain('confirm your journey details');
      expect(result).toContain('Date: 15 Nov 2024');
      expect(result).toContain('From: Kings Cross');
      expect(result).toContain('To: Edinburgh');
      expect(result).toContain('Time: 14:30');
      expect(result).not.toContain('{{date}}');
      expect(result).not.toContain('{{from}}');
      expect(result).not.toContain('{{to}}');
      expect(result).not.toContain('{{time}}');
    });

    it('should return TICKET_REQUEST template', () => {
      const result = service.getTemplate('TICKET_REQUEST');

      expect(result).toContain('photo of your ticket');
      expect(result).toContain('journey details');
      expect(result).toContain('date of travel');
    });

    it('should return ERROR_INVALID_INPUT template with hint', () => {
      const result = service.getTemplate('ERROR_INVALID_INPUT', { hint: 'Please use format: DD/MM/YYYY' });

      expect(result).toContain("didn't understand");
      expect(result).toContain('Please use format: DD/MM/YYYY');
      expect(result).not.toContain('{{hint}}');
    });

    it('should return ERROR_TIMEOUT template', () => {
      const result = service.getTemplate('ERROR_TIMEOUT');

      expect(result).toContain('session has expired');
      expect(result).toContain('inactivity');
    });

    it('should throw error for unknown template name', () => {
      expect(() => {
        service.getTemplate('UNKNOWN_TEMPLATE' as TemplateName);
      }).toThrow('Unknown template');
    });

    it('should handle missing variables gracefully', () => {
      // Template with variables but none provided
      const result = service.getTemplate('OTP_REQUEST');

      // Should still contain the template but with placeholder
      expect(result).toContain('{{code}}');
    });

    it('should handle partial variable substitution', () => {
      const variables = {
        date: '15 Nov',
        from: 'London',
        // Missing 'to' and 'time'
      };

      const result = service.getTemplate('JOURNEY_CONFIRMATION', variables);

      expect(result).toContain('Date: 15 Nov');
      expect(result).toContain('From: London');
      expect(result).toContain('{{to}}'); // Should remain as placeholder
      expect(result).toContain('{{time}}'); // Should remain as placeholder
    });

    it('should substitute multiple occurrences of same variable', () => {
      // Create a test scenario where same variable appears multiple times
      const result = service.getTemplate('OTP_REQUEST', { code: '999999' });

      // Should replace the code variable
      expect(result).toContain('999999');
      expect(result).not.toContain('{{code}}');
    });

    it('should not modify variables case', () => {
      const result = service.getTemplate('ERROR_INVALID_INPUT', { hint: 'Use UPPERCASE Format' });

      expect(result).toContain('Use UPPERCASE Format');
    });

    it('should handle special characters in variable values', () => {
      const result = service.getTemplate('JOURNEY_CONFIRMATION', {
        date: '15/11/2024',
        from: "King's Cross",
        to: 'Edinburgh (Waverley)',
        time: '14:30',
      });

      expect(result).toContain("King's Cross");
      expect(result).toContain('Edinburgh (Waverley)');
    });
  });

  describe('integration: formatTwiML + getTemplate', () => {
    it('should format template output as TwiML', () => {
      const template = service.getTemplate('WELCOME_FIRST_TIME');
      const twiml = service.formatTwiML(template);

      expect(twiml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(twiml).toContain('<Response>');
      expect(twiml).toContain('<Message>');
      expect(twiml).toContain('Welcome to RailRepay');
      expect(twiml).toContain('</Message>');
      expect(twiml).toContain('</Response>');
    });

    it('should escape special characters in template variables', () => {
      const template = service.getTemplate('JOURNEY_CONFIRMATION', {
        date: '15 Nov',
        from: '<script>alert("xss")</script>',
        to: 'London & Beyond',
        time: '14:30',
      });

      const twiml = service.formatTwiML(template);

      expect(twiml).toContain('&lt;script&gt;');
      expect(twiml).toContain('&amp; Beyond');
    });
  });
});
