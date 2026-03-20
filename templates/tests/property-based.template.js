'use strict';

/**
 * Property-Based Testing 템플릿
 * fast-check로 불변조건을 500가지 랜덤 입력으로 자동 검증
 *
 * 사용법: 이 파일을 domains/{id}/tests/domain/ 에 복사하고
 *         Entity, INV, arbitraries를 도메인에 맞게 수정
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');

// ---- 아래를 도메인에 맞게 교체 ----
// const { YourEntity } = require('../../src/domain/entities/YourEntity');

describe('Property-Based: 불변조건 검증', () => {

  it('INV-XXX: (불변조건 설명)', () => {
    fc.assert(
      fc.property(
        fc.record({
          amount:  fc.integer({ min: -1_000_000, max: 1_000_000 }),
          name:    fc.string({ minLength: 0, maxLength: 1000 }),
          status:  fc.constantFrom('DRAFT', 'APPROVED', 'REJECTED', 'COMPLETED'),
        }),
        (input) => {
          if (input.amount < 0) {
            assert.throws(
              () => { /* new YourValueObject(input.amount) */ },
              (err) => err.message.includes('INV-')
            );
          }
        }
      ),
      { numRuns: 500 }
    );
  });

  it('INV-YYY: 상태 전이는 항상 유효해야 함', () => {
    const valid = {
      DRAFT: ['APPROVED', 'REJECTED'],
      APPROVED: ['COMPLETED'],
      REJECTED: [],
      COMPLETED: [],
    };
    fc.assert(
      fc.property(
        fc.constantFrom('DRAFT', 'APPROVED', 'REJECTED', 'COMPLETED'),
        fc.constantFrom('DRAFT', 'APPROVED', 'REJECTED', 'COMPLETED'),
        (from, to) => {
          const isValid = (valid[from] || []).includes(to);
          if (!isValid) {
            // entity.transitionTo(to)가 에러를 던져야 함
            // assert.throws(() => entity.transitionTo(to), (e) => e.message.includes('INV-'));
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
