/**
 * Start Handler Tests - Written FIRST per ADR-014 (TDD)
 *
 * SPEC: Day 5 § 2.1 Start Handler
 * Per ADR-014: These tests define the behavior
 *
 * Test cases:
 * 1. New user (no user record) → Create user, send WELCOME_FIRST_TIME, transition to AWAITING_TERMS
 * 2. Returning user (verified) → Send welcome back, transition to AUTHENTICATED
 * 3. Returning user (not verified) → Resume verification flow, transition to AWAITING_OTP
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { startHandler } from '../../../src/handlers/start.handler';
import { FSMState } from '../../../src/services/fsm.service';
import type { HandlerContext } from '../../../src/handlers';
import type { User } from '../../../src/db/types';
import type { UserRepository } from '../../../src/db/repositories/user.repository';

describe('Start Handler', () => {
  let mockContext: HandlerContext;

  beforeEach(() => {
    mockContext = {
      phoneNumber: '+447700900123',
      messageBody: 'Hello',
      messageSid: 'SM123',
      user: null,
      currentState: FSMState.START,
      correlationId: 'test-corr-id',
    };
  });

  describe('New user (no user record)', () => {
    it('should return welcome message for first-time user', async () => {
      // Arrange
      mockContext.user = null;

      // Act
      const result = await startHandler(mockContext);

      // Assert
      expect(result.response).toContain('Welcome to RailRepay');
      expect(result.response).toContain('get started');
    });

    it('should transition to AWAITING_TERMS for new user', async () => {
      // Arrange
      mockContext.user = null;

      // Act
      const result = await startHandler(mockContext);

      // Assert
      expect(result.nextState).toBe(FSMState.AWAITING_TERMS);
    });

    it('should include terms acceptance prompt', async () => {
      // Arrange
      mockContext.user = null;

      // Act
      const result = await startHandler(mockContext);

      // Assert
      expect(result.response).toContain('terms');
      expect(result.response).toContain('YES');
    });

    it('should not publish any events for new user (user creation handled elsewhere)', async () => {
      // Arrange
      mockContext.user = null;

      // Act
      const result = await startHandler(mockContext);

      // Assert
      // Start handler doesn't create user - that's done by webhook controller
      expect(result.publishEvents).toBeUndefined();
    });
  });

  describe('User Creation (Bug Fix)', () => {
    it('should create user when ctx.user is null and userRepository provided', async () => {
      // Arrange
      mockContext.user = null;
      const mockUserRepository = {
        create: vi.fn().mockResolvedValue({
          id: 'new-user-id',
          phone_number: '+447700900123',
          verified_at: null,
          created_at: new Date(),
          updated_at: new Date(),
        }),
        findByPhone: vi.fn(),
        update: vi.fn(),
      } as unknown as UserRepository;

      // Act
      const result = await startHandler(mockContext, mockUserRepository);

      // Assert
      expect(mockUserRepository.create).toHaveBeenCalledWith({
        phone_number: '+447700900123',
      });
      expect(result.nextState).toBe(FSMState.AWAITING_TERMS);
    });

    it('should publish user.registered event when creating new user', async () => {
      // Arrange
      mockContext.user = null;
      const createdUser: User = {
        id: 'new-user-id',
        phone_number: '+447700900123',
        verified_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };
      const mockUserRepository = {
        create: vi.fn().mockResolvedValue(createdUser),
        findByPhone: vi.fn(),
        update: vi.fn(),
      } as unknown as UserRepository;

      // Act
      const result = await startHandler(mockContext, mockUserRepository);

      // Assert
      expect(result.publishEvents).toBeDefined();
      expect(result.publishEvents?.length).toBe(1);
      const event = result.publishEvents![0];
      expect(event.event_type).toBe('user.registered');
      expect(event.aggregate_type).toBe('user');
      expect(event.aggregate_id).toBe(createdUser.id);
      expect(event.payload).toMatchObject({
        user_id: createdUser.id,
        phone_number: createdUser.phone_number,
        correlation_id: mockContext.correlationId,
        causation_id: mockContext.messageSid,
      });
    });

    it('should NOT create user when ctx.user already exists', async () => {
      // Arrange
      const existingUser: User = {
        id: 'existing-user-id',
        phone_number: '+447700900123',
        verified_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };
      mockContext.user = existingUser;
      const mockUserRepository = {
        create: vi.fn(),
        findByPhone: vi.fn(),
        update: vi.fn(),
      } as unknown as UserRepository;

      // Act
      const result = await startHandler(mockContext, mockUserRepository);

      // Assert - should NOT create user
      expect(mockUserRepository.create).not.toHaveBeenCalled();
      expect(result.nextState).toBe(FSMState.AWAITING_TERMS);
    });

    it('should work without userRepository (backward compatibility)', async () => {
      // Arrange
      mockContext.user = null;

      // Act
      const result = await startHandler(mockContext);

      // Assert - should still return welcome message
      expect(result.response).toContain('Welcome to RailRepay');
      expect(result.nextState).toBe(FSMState.AWAITING_TERMS);
    });
  });

  describe('Returning verified user', () => {
    it('should return welcome back message for verified user', async () => {
      // Arrange
      const verifiedUser: User = {
        id: 'user-123',
        phone_number: '+447700900123',
        verified_at: new Date('2024-11-15T10:00:00Z'),
        created_at: new Date('2024-11-01T10:00:00Z'),
        updated_at: new Date('2024-11-15T10:00:00Z'),
      };
      mockContext.user = verifiedUser;

      // Act
      const result = await startHandler(mockContext);

      // Assert
      expect(result.response).toContain('Welcome back');
    });

    it('should transition to AUTHENTICATED for verified user', async () => {
      // Arrange
      const verifiedUser: User = {
        id: 'user-123',
        phone_number: '+447700900123',
        verified_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      };
      mockContext.user = verifiedUser;

      // Act
      const result = await startHandler(mockContext);

      // Assert
      expect(result.nextState).toBe(FSMState.AUTHENTICATED);
    });

    it('should include main menu options in response', async () => {
      // Arrange
      const verifiedUser: User = {
        id: 'user-123',
        phone_number: '+447700900123',
        verified_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      };
      mockContext.user = verifiedUser;

      // Act
      const result = await startHandler(mockContext);

      // Assert
      expect(result.response).toContain('DELAY');
      expect(result.response).toContain('STATUS');
    });
  });

  describe('Returning unverified user', () => {
    it('should resume verification flow for unverified user', async () => {
      // Arrange
      const unverifiedUser: User = {
        id: 'user-123',
        phone_number: '+447700900123',
        verified_at: null, // Not verified
        created_at: new Date('2024-11-01T10:00:00Z'),
        updated_at: new Date('2024-11-01T10:00:00Z'),
      };
      mockContext.user = unverifiedUser;

      // Act
      const result = await startHandler(mockContext);

      // Assert
      expect(result.response).toContain('verification');
      expect(result.response).toContain('continue');
    });

    it('should transition to AWAITING_TERMS for unverified user', async () => {
      // Arrange
      const unverifiedUser: User = {
        id: 'user-123',
        phone_number: '+447700900123',
        verified_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };
      mockContext.user = unverifiedUser;

      // Act
      const result = await startHandler(mockContext);

      // Assert
      expect(result.nextState).toBe(FSMState.AWAITING_TERMS);
    });

    it('should prompt for terms acceptance again', async () => {
      // Arrange
      const unverifiedUser: User = {
        id: 'user-123',
        phone_number: '+447700900123',
        verified_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };
      mockContext.user = unverifiedUser;

      // Act
      const result = await startHandler(mockContext);

      // Assert
      expect(result.response).toContain('terms');
      expect(result.response).toContain('YES');
    });
  });
});
