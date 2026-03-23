// @ts-check
'use strict';

/**
 * VideoController — 프레임워크 독립 HTTP 인터페이스 계층 (ADR-0002)
 *
 * 역할:
 *   - openapi.yaml의 7개 엔드포인트를 유스케이스로 라우팅
 *   - video:read / video:write / video:admin 권한 강제
 *   - 도메인 오류 → HTTP 상태 코드 변환
 *   - 도메인 엔티티 → API 응답 직렬화
 */

const { UploadVideoUseCase }       = require('../application/UploadVideoUseCase');
const { GetVideoUseCase }          = require('../application/GetVideoUseCase');
const { ListVideosUseCase }        = require('../application/ListVideosUseCase');
const { StartTranscodeJobUseCase } = require('../application/StartTranscodeJobUseCase');
const { GetTranscodeJobUseCase }   = require('../application/GetTranscodeJobUseCase');
const { ChangeAccessPolicyUseCase } = require('../application/ChangeAccessPolicyUseCase');
const { ArchiveVideoUseCase }      = require('../application/ArchiveVideoUseCase');

const { fromError } = require('../../../../src/shared/ProblemDetails');

class VideoController {
  /**
   * @param {{
   *   videoRepository:       object,
   *   transcodeJobRepository: object,
   *   eventPublisher?:        Function,
   * }} deps
   */
  constructor({ videoRepository, transcodeJobRepository, eventPublisher = () => {} }) {
    this._videoRepo  = videoRepository;
    this._jobRepo    = transcodeJobRepository;
    this._publisher  = eventPublisher;

    this._uploadVideo        = new UploadVideoUseCase({ videoRepository });
    this._getVideo           = new GetVideoUseCase({ videoRepository });
    this._listVideos         = new ListVideosUseCase({ videoRepository });
    this._startTranscode     = new StartTranscodeJobUseCase({ videoRepository, transcodeJobRepository });
    this._getTranscodeJob    = new GetTranscodeJobUseCase({ videoRepository, transcodeJobRepository });
    this._changeAccessPolicy = new ChangeAccessPolicyUseCase({ videoRepository });
    this._archiveVideo       = new ArchiveVideoUseCase({ videoRepository });
  }

  /**
   * 요청 처리 진입점
   * @param {{
   *   method: string,
   *   path: string,
   *   params?: Record<string, string>,
   *   query?: Record<string, string>,
   *   body?: object,
   *   caller: { permissions: string[], userId?: string },
   *   correlationId?: string,
   * }} req
   * @returns {Promise<{ status: number, body: object }>}
   */
  async handle(req) {
    try {
      return await this._route(req);
    } catch (err) {
      return this._errorResponse(err, req.correlationId);
    }
  }

  // ── 라우팅 ───────────────────────────────────────────────────────────────────

  async _route({ method, path, params = {}, query = {}, body = {}, caller, correlationId }) {

    // POST /videos — uploadVideo (operationId)
    if (method === 'POST' && path === '/videos') {
      // 보안: uploaderId는 인증된 caller.userId만 허용 — body.uploader_id 덮어쓰기 차단
      const video = await this._uploadVideo.execute(
        {
          title:           body.title,
          uploaderId:      caller.userId || '',
          originalFileRef: body.original_file_ref,
          accessPolicy:    body.access_policy,
          description:     body.description,
          fileSizeBytes:   body.file_size_bytes,
        },
        caller,
      );
      this._publisher({ type: 'VideoUploaded', videoId: video.videoId, correlationId });
      return { status: 201, body: this._serializeVideo(video) };
    }

    // GET /videos — listVideos
    if (method === 'GET' && path === '/videos') {
      const result = await this._listVideos.execute(
        {
          status:     query.status,
          uploaderId: query.uploader_id,
          page:       query.page      ? Number(query.page)      : 1,
          pageSize:   query.page_size ? Number(query.page_size) : 20,
        },
        caller,
      );
      return {
        status: 200,
        body: {
          items:     result.items.map(v => this._serializeVideo(v)),
          total:     result.total,
          page:      result.page,
          page_size: result.page_size,
        },
      };
    }

    // GET /videos/:videoId — getVideo
    if (method === 'GET' && path === '/videos/:videoId') {
      const video = await this._getVideo.execute(
        { videoId: params.videoId },
        caller,
      );
      return { status: 200, body: this._serializeVideo(video) };
    }

    // POST /videos/:videoId/transcode — startTranscodeJob
    if (method === 'POST' && path === '/videos/:videoId/transcode') {
      const job = await this._startTranscode.execute(
        {
          videoId:          params.videoId,
          targetFormat:     body.target_format,
          targetResolution: body.target_resolution,
        },
        caller,
      );
      this._publisher({ type: 'TranscodeJobStarted', jobId: job.jobId, videoId: job.videoId, correlationId });
      return { status: 201, body: this._serializeJob(job) };
    }

    // GET /videos/:videoId/transcode-jobs/:jobId — getTranscodeJob
    if (method === 'GET' && path === '/videos/:videoId/transcode-jobs/:jobId') {
      const job = await this._getTranscodeJob.execute(
        { videoId: params.videoId, jobId: params.jobId },
        caller,
      );
      return { status: 200, body: this._serializeJob(job) };
    }

    // PATCH /videos/:videoId/access-policy — changeAccessPolicy
    if (method === 'PATCH' && path === '/videos/:videoId/access-policy') {
      const video = await this._changeAccessPolicy.execute(
        { videoId: params.videoId, accessPolicy: body.access_policy },
        caller,
      );
      this._publisher({ type: 'VideoAccessPolicyChanged', videoId: video.videoId, correlationId });
      return { status: 200, body: this._serializeVideo(video) };
    }

    // POST /videos/:videoId/archive — archiveVideo
    if (method === 'POST' && path === '/videos/:videoId/archive') {
      const video = await this._archiveVideo.execute(
        { videoId: params.videoId },
        caller,
      );
      this._publisher({ type: 'VideoArchived', videoId: video.videoId, correlationId });
      return { status: 200, body: this._serializeVideo(video) };
    }

    return { status: 404, body: { code: 'NOT_FOUND', message: `Route not found: ${method} ${path}` } };
  }

  // ── 직렬화 ───────────────────────────────────────────────────────────────────

  _serializeVideo(video) {
    return {
      video_id:          video.videoId,
      title:             video.title,
      uploader_id:       video.uploaderId,
      original_file_ref: video.originalFileRef,
      status:            video.status,
      access_policy:     video.accessPolicy,
      description:       video.description ?? null,
      duration_seconds:  video.durationSeconds ?? null,
      file_size_bytes:   video.fileSizeBytes ?? null,
      created_at:        video.createdAt,
      updated_at:        video.updatedAt,
    };
  }

  _serializeJob(job) {
    return {
      job_id:               job.jobId,
      video_id:             job.videoId,
      status:               job.status,
      target_format:        job.targetFormat,
      target_resolution:    job.targetResolution,
      output_rendition_ref: job.outputRenditionRef || null,
      progress_percent:     job.progressPercent !== null ? job.progressPercent : null,
      error_message:        job.errorMessage       || null,
      created_at:           job.createdAt,
      completed_at:         job.completedAt        || null,
    };
  }

  // ── 에러 응답 ────────────────────────────────────────────────────────────────

  _errorResponse(err, correlationId) {
    return fromError(err, { correlationId });
  }
}

module.exports = { VideoController };
