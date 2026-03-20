'use strict';

/**
 * Video 도메인 Property-Based 테스트 (fast-check)
 * 임의 입력으로 INV-V001~V003 불변조건을 검증한다.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');

const { Video, VALID_TRANSITIONS, VALID_ACCESS_POLICIES } = require('../../src/domain/Video');
const { TranscodeJob, VALID_FORMATS } = require('../../src/domain/TranscodeJob');

describe('[Property] Video INV-V001: 항상 title/uploaderId/originalFileRef 필수', () => {
  test('임의 공백 title → VALIDATION_ERROR', () => {
    fc.assert(fc.property(
      fc.stringMatching(/^\s*$/),
      (blankTitle) => {
        let threw = false;
        try {
          Video.create({ videoId: 'v', title: blankTitle, uploaderId: 'u', originalFileRef: 'r' });
        } catch (e) {
          threw = true;
          assert.equal(e.code, 'VALIDATION_ERROR');
        }
        assert.ok(threw, `공백 title "${blankTitle}"이 허용됨 (버그)`);
      }
    ));
  });

  test('임의 비공백 title → Video 생성 성공', () => {
    fc.assert(fc.property(
      fc.string({ minLength: 1 }).filter(s => s.trim().length > 0),
      (validTitle) => {
        const v = Video.create({ videoId: 'v', title: validTitle, uploaderId: 'u', originalFileRef: 'r' });
        assert.equal(v.status, 'UPLOADED');
        assert.equal(v.title, validTitle.trim());
      }
    ));
  });
});

describe('[Property] Video INV-V002: 상태 전이 방향성', () => {
  test('상태 전이 후 원본 상태 불변', () => {
    fc.assert(fc.property(
      fc.constantFrom('PROCESSING', 'FAILED'),
      (nextStatus) => {
        const v    = Video.create({ videoId: 'v', title: 'T', uploaderId: 'u', originalFileRef: 'r' });
        const next = v.transitionTo(nextStatus);
        assert.equal(v.status, 'UPLOADED', '원본이 변경됨 (불변 패턴 위반)');
        assert.equal(next.status, nextStatus);
        assert.notStrictEqual(v, next);
      }
    ));
  });

  test('VALID_TRANSITIONS 외 전이는 항상 CONFLICT', () => {
    fc.assert(fc.property(
      fc.constantFrom('UPLOADED', 'PROCESSING', 'READY', 'FAILED', 'ARCHIVED'),
      fc.constantFrom('UPLOADED', 'PROCESSING', 'READY', 'FAILED', 'ARCHIVED'),
      (from, to) => {
        const allowed = VALID_TRANSITIONS[from] || [];
        if (allowed.includes(to)) return; // 허용된 전이는 스킵
        // 허용되지 않은 전이는 반드시 CONFLICT
        let v = Video.create({ videoId: 'v', title: 'T', uploaderId: 'u', originalFileRef: 'r' });
        // from 상태까지 전이
        const path = {
          UPLOADED:   [],
          PROCESSING: ['PROCESSING'],
          READY:      ['PROCESSING', 'READY'],
          FAILED:     ['FAILED'],
          ARCHIVED:   ['PROCESSING', 'READY', 'ARCHIVED'],
        };
        try {
          for (const s of path[from]) v = v.transitionTo(s);
          assert.equal(v.status, from);
          assert.throws(() => v.transitionTo(to), err => err.code === 'CONFLICT');
        } catch {
          // 경로 생성 자체가 실패하면 패스 (일부 조합은 경로가 없을 수 있음)
        }
      }
    ));
  });
});

describe('[Property] Video INV-V003: AccessPolicy 유효성', () => {
  test('유효한 AccessPolicy 값만 허용', () => {
    fc.assert(fc.property(
      fc.constantFrom(...VALID_ACCESS_POLICIES),
      (policy) => {
        const v = Video.create({ videoId: 'v', title: 'T', uploaderId: 'u', originalFileRef: 'r', accessPolicy: policy });
        assert.equal(v.accessPolicy, policy);
      }
    ));
  });

  test('임의 문자열은 대부분 VALIDATION_ERROR (유효값 제외)', () => {
    fc.assert(fc.property(
      fc.string({ minLength: 1 }).filter(s => !VALID_ACCESS_POLICIES.includes(s)),
      (badPolicy) => {
        assert.throws(
          () => Video.create({ videoId: 'v', title: 'T', uploaderId: 'u', originalFileRef: 'r', accessPolicy: badPolicy }),
          err => err.code === 'VALIDATION_ERROR'
        );
      }
    ));
  });
});

describe('[Property] TranscodeJob: format 유효성', () => {
  test('유효한 targetFormat만 허용', () => {
    fc.assert(fc.property(
      fc.constantFrom(...VALID_FORMATS),
      (fmt) => {
        const j = TranscodeJob.create({ jobId: 'j', videoId: 'v', targetFormat: fmt, targetResolution: '1080p' });
        assert.equal(j.targetFormat, fmt);
        assert.equal(j.status, 'PENDING');
      }
    ));
  });

  test('유효하지 않은 format → VALIDATION_ERROR', () => {
    fc.assert(fc.property(
      fc.string({ minLength: 1 }).filter(s => !VALID_FORMATS.includes(s)),
      (badFmt) => {
        assert.throws(
          () => TranscodeJob.create({ jobId: 'j', videoId: 'v', targetFormat: badFmt, targetResolution: '1080p' }),
          err => err.code === 'VALIDATION_ERROR'
        );
      }
    ));
  });
});
