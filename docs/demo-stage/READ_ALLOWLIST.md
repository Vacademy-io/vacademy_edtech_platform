# Read-only demo user: what is allowed and what is refused

Binding rule: `docs/demo-stage/SPEC.md` section 3. Code:

- Java, every Spring service: `common_service/.../auth/demo/DemoReadOnlyGate.java` (decision and 403 body) and
  `DemoReadOnlyAllowList.java` (the lists below), called from `JwtAuthFilter` and from assessment_service's
  `AssessmentJwtAuthFilter`.
- ai_service: `app/core/demo_read_only.py` (rule, lists, middleware), called from `app_factory.py`,
  `core/security.py` and `mcp/principal.py`.

A request is the demo user's when the role `DEMO_READ_ONLY` is among the authorities loaded for the request's
institute, or the token's `authorities` claim lists it under **any** institute (the `clientId` header is chosen by
the caller, so it cannot be what switches the gate on). For such a request:

| Method | Outcome |
|---|---|
| `OPTIONS` | passes |
| `GET`, `HEAD` | passes, unless the path is in "GETs refused" below |
| anything else | refused, unless method + path is in "Allowed non-GET reads" below |

Refusal: `403`, `Content-Type: application/json`, body exactly
`{"code":"DEMO_READ_ONLY","message":"This is a demo. Changes are not saved."}`.

Changing a list: edit the Java class (or the Python list), this file, and the two counts in
`DemoReadOnlyGateTest.listSizesMatchTheDocument`. Add a non-GET entry only after reading the controller and the
service behind it; when unsure, leave it out. A missing entry shows an error on one demo screen. A wrong entry is a hole.

## Runtimes that accept a user token

| Runtime | Where the token is checked | Gate |
|---|---|---|
| auth_service | `common_service/.../auth/filter/JwtAuthFilter.java` (user loaded from its own DB by `core/config/UserDetailsServiceImpl`) | `DemoReadOnlyGate` in the filter |
| admin_core_service, media_service, notification_service, community_service | the same `JwtAuthFilter`; the user comes from auth-service `GET /auth-service/v1/internal/user` through each service's `UserDetailsService`, cached | same filter, same gate |
| assessment_service | its own copy, `core/filter/AssessmentJwtAuthFilter.java` | `DemoReadOnlyGate` called from that filter too |
| ai_service | `app/core/security.py` (`get_current_user`, `get_optional_user`, `get_pinned_principal`, `decode_access_token`, `jwt_institute_roles`); many routers call these themselves or take no auth at all | `DemoReadOnlyMiddleware` on every HTTP request, plus the three dependencies, the socket token check and the MCP token replay |
| voice_bot_service | no user tokens: shared secret and per-call signed stream URLs (`app/main.py`) | not needed |
| ai_service `render_worker/`, `runpod_worker/` | no user tokens | not needed |
| engage-client, lead-agent-extension, demo-stage, the two frontends | browser code, no server | not applicable |

`JwtAuthFilter` is a Spring bean, so it runs on every request that carries a bearer token, including the
`permitAll` paths (`/open/**`, `/public/**`, webhooks). A demo token attached to an open route is therefore gated
like any other request; the same route called with no token is not (see "Not user-token routes").

Other credentials the filter does not handle, none of which the demo user can create (all creation routes are
non-GET): institute API keys (`ApiKeyAuthFilter`, `CatalogApiAuth`, `AiCallingApiAuth`), service signatures
(`InternalAuthFilter`, `HmacAuthFilter`), panel tokens (`PanelBearerGuard`), MCP access tokens, Site Assistant
and demo-guide visitor tokens.

## How the lists were built

1. Every Spring mapping was extracted from the six services (1,510 GET, 1,820 non-GET).
2. Non-GET candidates: POST/PUT routes whose path or method name reads like a query (search, list, filter, get,
   report, preview, ...) **and** whose path appears in `frontend-admin-dashboard/src`: 214 routes.
3. Each of the 214 was traced from the controller through the service to the repositories and clients. Verdicts:
   110 read-only, 96 write/send/spend/export, 8 unsure. Unsure counts as refused.
4. From the 110, previews, internal routes, routes outside the admin app and one route that forwards the caller's
   token to a refused endpoint were dropped; `/auth-service/v1/refresh-token` was added. Result: 93 entries.
   2026-11-20: six more added after a sweep of every sidebar screen as the demo visitor found screens that
   could not load (applicants, payment summary, learning reports, the main Learners list, the Team list). Each
   handler was read end to end; the two that used to return passwords now leave them out for the demo user. Result: 99.
   No entry overlaps a write route of the same shape (checked by script against all 1,820 non-GET routes).
5. GETs: all 1,510 were reviewed for writes, sends, spend, credentials and bulk exports: 588 by reading the
   handler and what it calls, 922 by a static call tracer with a hand read of every hit (654 of those rest on the
   tracer alone, see "Known gaps").

## Allowed non-GET reads (99)


### admin-core-service: Fee tracking: search, collection dashboard, adjustment lists

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/admin-core-service/v1/admin/student-fee/adjustment/history` | `FeeTrackingAdminController#getInstituteAdjustmentHistory` | AdjustmentHistoryQueryService.getInstituteHistory is @Transactional(readOnly=true): adjustmentHistoryRepository.findAll(spec) + enrichment reads |
| POST | `/admin-core-service/v1/admin/student-fee/adjustment/pending` | `FeeTrackingAdminController#getPendingAdjustments` | FeeTrackingService.getPendingAdjustments is @Transactional(readOnly=true): bill/adjustment reads + auth user lookup |
| POST | `/admin-core-service/v1/admin/student-fee/dashboard/collection` | `FeeTrackingAdminController#getCollectionDashboard` | FeeTrackingService.getCollectionDashboard is @Transactional(readOnly=true): collectionDashboardRepository summary SELECTs |
| POST | `/admin-core-service/v1/admin/student-fee/search` | `FeeTrackingAdminController#searchStudentFeePayments` | FeeTrackingService.searchFeePayments is @Transactional(readOnly=true): studentFeePaymentRepository.findAll + native SELECT search |

### admin-core-service: Admissions: paged list of admission responses

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/admin-core-service/v1/admission/responses/list` | `AdmissionController#listAdmissionResponses` | AdmissionResponsesService.list -> native SELECT (AdmissionResponsesRepositoryCustomImpl) + findByUserIdIn/findAllById lookups; no writes |
| POST | `/admin-core-service/v1/applicant/list` | `ApplicantAdminController` | ApplicantService list: four repository SELECTs + auth-service users-with-children lookup; fields copied one by one, no credential |

### admin-core-service: Leads, enquiries, campaigns: lists and analytics that post a filter body

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/admin-core-service/v1/audience/campaigns` | `AudienceController#getCampaigns` | AudienceService.getCampaigns -> role-access read, findAudiencesWithFilters, counselor pool lookups; no writes |
| POST | `/admin-core-service/v1/audience/center-heatmap` | `AudienceAnalyticsController#getCenterHeatmap` | AudienceAnalyticsService.getCenterHeatmap -> cached setting read + audienceRepository.getCenterHeatmapByInstitute SELECT |
| POST | `/admin-core-service/v1/audience/distinct-institute-users-and-audience` | `AllInstituteUserAndAudience#getCombinedUsersWithCustomFields` | DistinctUserAudienceService -> paged SELECTs + auth-service user lookup (search GET / users-by-ids) + lead-profile findBy; no writes. Returns contact PII page |
| POST | `/admin-core-service/v1/audience/enquiries` | `AudienceController#getEnquiries` | AudienceService.getEnquiriesWithResponses -> findEnquiriesWithFilters + find* enrichments + auth-service users-with-children lookup; no writes |
| POST | `/admin-core-service/v1/audience/leads` | `AudienceController#getLeads` | AudienceService.getLeads -> visibility/SLA/dedup setting reads, findInstituteLeadsWithFilters/findLeadsWithFilters, mapResponsesToLeadDetails (find* only); only non-read … |
| POST | `/admin-core-service/v1/audience/user-lead-profiles/batch` | `AudienceController#getBatchLeadProfiles` | UserLeadProfileService.getProfilesForUsers -> findByUserIdInAndInstituteId + toDTO; no get-or-create |

### admin-core-service: Batches: search

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/admin-core-service/batch/v1/search` | `BatchController#searchPackages` | BatchService.searchPackagesByInstitute: PackageRepository.findPackagesByCriteria + PackageSessionRepository.findBatchDetailsWithLatestInviteCode only (no auth attribute … |

### admin-core-service: CRM dashboard query

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/admin-core-service/v1/crm-dashboard` | `CrmDashboardController#getDashboard` | CrmDashboardService.getDashboard -> in-memory Caffeine cache + readOnlyTx jdbc queries, audienceService.getLeads, leadFollowupService.completed (reads); no jdbc.update … |

### admin-core-service: Enrol invites: list and lookup by payment option

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/admin-core-service/v1/enroll-invite/get-by-payment-option-ids` | `EnrollInviteController#getByPaymentOptionIds` | EnrollInviteService.findByPaymentOptionIds -> mapping SELECT + buildFullEnrollInviteDTO (setting/custom-field reads) |
| POST | `/admin-core-service/v1/enroll-invite/get-enroll-invite` | `EnrollInviteController#getEnrollInvite` | EnrollInviteService.getEnrollInvitesByInstituteIdAndFilters -> repository SELECTs, payment summaries, auth-service name lookup, short-URL base-url GET to media-service … |

### admin-core-service: Live classes: session search

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/admin-core-service/get-sessions/search` | `GetSessionsListController#searchSessions` | GetLiveSessionService.searchSessions: LiveSessionRepository.searchSessions + participant/package-session/instructor SELECTs; LiveSessionVisibilityService reads institute … |

### admin-core-service: Institute: batches by id

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/admin-core-service/institute/v1/batches-by-ids/*` | `UserInstituteController#getBatchesByIds` | InstituteInitManager.getBatchesByIds -> findPackageSessionsByInstituteIdAndIds + read-time SELECT |

### admin-core-service: Doubts: filtered list

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/admin-core-service/institute/v1/doubts/get-all` | `DoubtsController#addDoubts` | DoubtsManager.getAllDoubts -> setting read, doubtsRepository.findDoubtsWithFilter*, createDtoFromDoubts (find* only) [controller method is misnamed addDoubts; it is a … |

### admin-core-service: Faculty: filtered list

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/admin-core-service/institute/v1/faculty/faculty/get-all` | `FacultyController#getAllTeachers` | FacultyService.getAllFaculty -> facultyRepository.findByFilters* + DTO mapping |

### admin-core-service: Learners: v1 and v2 lists (no credentials for the demo user) and learner stats

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/admin-core-service/institute/institute_learner/get/v1/all` | `InstituteGetStudentController#getLinkedStudents` | StudentListManager.getLinkedStudents -> faculty access filter reads, studentFilterService SELECTs, attendance report reads; no writes. Returns learner PII page |
| POST | `/admin-core-service/institute/institute_learner/get/v2/all` | `StudentGetV2Controller#getLinkedStudentsV2` | StudentListManager.getLinkedStudentsV2: SELECTs + `SET LOCAL plan_cache_mode`; no writes. The password enrichment (`enrichWithUserCredentials`) is skipped when `DemoReadOnlyGate.isDemoCaller` is true, so no row carries a password for the demo user |
| POST | `/admin-core-service/institute/institute_learner/stats/users` | `StudentStatsController#getStudentStats` | StudentStatsManager.getStudentStats -> findUserStatsWithTypePaginated + auth-service user lookup |

### admin-core-service: Bulk upload: returns the CSV column layout only

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/admin-core-service/institute/institute_learner-bulk/v1/init-institute_learner-upload` | `InstituteCSVBulkStudentController#getCSVUploadSetupDetailsForStudent` | StudentBulkInitUploadManager.generateCsvUploadForStudents builds the CSV header/validation config in memory; no DB or file access |

### admin-core-service: Templates: search

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/admin-core-service/institute/template/v1/search` | `TemplateController#searchTemplates` | TemplateService.searchTemplates -> templateRepository.findBy* only |

### admin-core-service: Invoices: lookup by payment logs

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/admin-core-service/v1/invoices/by-payment-logs` | `InvoiceController#getInvoicesForPaymentLogs` | InvoiceService.getInvoicesForPaymentLogs -> invoicePaymentLogMappingRepository projection SELECT in chunks |

### admin-core-service: Lead status: admission check lookup

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/admin-core-service/v1/lead-status/admission-check` | `LeadStatusController#admissionCheckForMany` | AdmissionCourseRuleService.check -> institute setting read + AdmissionCourseDao native SELECT; no writes |

### admin-core-service: Learner invitations: lists

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/admin-core-service/learner-invitation/invitation-details` | `LearnerInvitationController#getInvitationDetails` | LearnerInvitationService.getInvitationDetails: LearnerInvitationRepository.findInvitationsWithAcceptedCount[ByName] only |
| POST | `/admin-core-service/learner-invitation/invitation-responses` | `LearnerInvitationController#getLearnerInvitationResponses` | LearnerInvitationResponseService.getLearnerInvitationResponses: LearnerInvitationResponseRepository.findByInstituteIdAndStatusWithCustomFields only |

### admin-core-service: Learner and batch progress reports (JSON; the PDF exports are not here)

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/admin-core-service/learner-management/batch-report` | `BatchReportController#getBatchReportDetails` | BatchReportService.getBatchReport: ActivityLogRepository / ConcentrationScoreRepository aggregate SELECTs only |
| POST | `/admin-core-service/learner-management/batch-report/leaderboard` | `BatchReportController#getBatchActivityDataWithRanks` | BatchReportService.getBatchActivityData: ActivityLogRepository.getBatchActivityDataWithRankPaginated only |
| POST | `/admin-core-service/learner-management/batch-summary-report/daily-time` | `BatchSummaryReportController` | BatchSummaryReportService: activityLogRepository.findDailyTimeForInstitute / findDailyTimeForBatches, SELECTs only |
| POST | `/admin-core-service/learner-management/batch-summary-report/summary` | `BatchSummaryReportController` | BatchSummaryReportService summary: settings JSON, assessment-service cohort history lookup, stored analysis JSON (no LLM), SELECTs. The WhatsApp/email/PDF code is reached only from `/send`, which is refused |
| POST | `/admin-core-service/learner-management/learner-report` | `LearnerReportController#getLearnerProgressReport` | LearnerReportService.getLearnerProgressReport + BatchReportService.getBatchReport: ActivityLogRepository / ConcentrationScoreRepository SELECTs only |
| POST | `/admin-core-service/learner-management/learner-report/slide-wise-progress` | `LearnerReportController#getSlideWiseProgress` | LearnerReportService.getSlideProgressForLearner: ActivityLogRepository.getSlideActivityByDate only |

### admin-core-service: Courses: catalogue search

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/admin-core-service/learner-packages/v1/search` | `LearnerPackageDetailController#getLearnerPackages` | LearnerPackageService.getLearnerPackageDetail: PackageRepository SELECTs, enrolment mapping read, CourseRoleLabelService read, auth-service user-details-list read |
| POST | `/admin-core-service/learner-packages/v1/search-by-user-id` | `LearnerPackageDetailController#getLearnerPackagesByUserId` | Same LearnerPackageService.getLearnerPackageDetail for a userId param: PackageRepository SELECTs + auth-service user-details-list read |

### admin-core-service: Learner activity: daily time spent

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/admin-core-service/learner-tracking/activity-log/learner/v1/daily-time-spent` | `LearnerActivityLogController#getDailyTimeSpentByLearner` | LearnerActivityDetailService.getLearnerAndBatchTimeSpent: ActivityLogRepository.getDailyUserAndBatchTimeSpent only |

### admin-core-service: Live class reports and dashboard

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/admin-core-service/live-session-report/all-attendance` | `AttendanceReport#getAttendanceFilterRequest` | AttendanceReportService.getAllByAttendanceFilterRequest: LiveSessionParticipantRepository.findDistinctStudentIdsWithFilters + getAttendanceReportForStudentIds only … |
| POST | `/admin-core-service/live-session-report/dashboard` | `LiveClassDashboardController#getDashboard` | LiveClassDashboardService.getDashboard: NamedParameterJdbcTemplate.query only (no update/execute in file) + instructor repo read + auth user directory read |
| POST | `/admin-core-service/live-session-report/dashboard/at-risk` | `LiveClassDashboardController#getAtRisk` | LiveClassDashboardDetailService.getAtRisk: jdbc.query only (:378,:407) + instructor repo read |
| POST | `/admin-core-service/live-session-report/dashboard/class-learners` | `LiveClassDashboardController#getClassLearners` | LiveClassDashboardDetailService.getClassLearners: jdbc.query only (LiveClassDashboardDetailService.java:290,296) |
| POST | `/admin-core-service/live-session-report/dashboard/feedback-comments` | `LiveClassDashboardController#getFeedbackComments` | LiveClassDashboardDetailService.getFeedbackWall: jdbc.query only (:481) + auth user directory read |
| POST | `/admin-core-service/live-session-report/feedback/search` | `AttendanceReport#searchFeedback` | AttendanceReportService.searchFeedback: LiveSessionParticipantRepository.searchFeedback only |

### admin-core-service: Coupon check (no redemption)

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/admin-core-service/open/v1/coupon/validate` | `OpenCouponController#validate` | CouponValidationService.validate: CouponCodeRepository/AppliedCouponDiscountRepository/scope repos finds only; does not redeem or count usage |

### admin-core-service: Public course catalogue search

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/admin-core-service/open/packages/v1/search` | `OpenPackageController#getLearnerPackages` | OpenPackageService.getLearnerPackageDetail: PackageRepository.getCatalogPackageDetail/getOpenCatalogPackageDetail + role labels + auth-service user-details-list read … |
| POST | `/admin-core-service/open/packages/v2/search` | `OpenPackageController#getLearnerPackagesV2` | OpenPackageService.getLearnerPackageDetailV2: PackageRepository.get[Open]CatalogPackageDetailV2 + role labels + auth-service user-details-list read |

### admin-core-service: Public ratings list

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/admin-core-service/open/rating/get-source-ratings` | `OperRatingController#getSourceRatings` | RatingService.getRatingsForSource -> findRatingsBySourceAndStatus + auth-service user lookup |

### admin-core-service: Batch seat availability

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/admin-core-service/package-session/inventory/batch-availability` | `PackageSessionInventoryController#getBatchAvailability` | PackageSessionService.getBatchAvailability: PackageSessionRepository.findAllById/findInstitutesOfPackageSessions + StockHoldService.heldQuantities (readOnly SUM) |

### admin-core-service: Courses: catalogue search

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/admin-core-service/packages/v1/search` | `PackageController#getLearnerPackages` | PackageService.getcourseCatalogDetail (@Transactional readOnly): PackageRepository.getCatalogPackageDetail + role labels + auth-service user-details-list read |

### admin-core-service: Payment options: list

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/admin-core-service/v1/payment-option/get-payment-options` | `PaymentOptionController#getPaymentOptions` | PaymentOptionService.getPaymentOptions: PaymentOptionRepository.findPaymentOptionsWithPaymentPlansNative + auth-service user-details-list read (not @Auditable) |

### admin-core-service: Payment plan markdown lookup

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/admin-core-service/v1/payment-plan/markdown/lookup` | `PaymentPlanMarkdownController#lookup` | PaymentPlanMarkdownService.lookup: PackageSessionLearnerInvitationToPaymentOptionRepository.findActiveBy* only |

### admin-core-service: Planning logs: list

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/admin-core-service/planning-logs/v1/list` | `PlanningLogController#getPlanningLogs` | PlanningLogService.getPlanningLogs (@Cacheable): planningLogRepository SELECT + auth-service user-details-list read |

### admin-core-service: Domain routing lookup used when the app boots

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/admin-core-service/public/domain-routing/v1/resolve` | `DomainRoutingController#resolve` | DomainRoutingService.resolve -> routingRepository.resolveMapping SELECT only (public endpoint) |

### admin-core-service: Ratings: lists

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/admin-core-service/rating/get-source-ratings` | `RatingController#getSourceRatings` | RatingService.getRatingsForSource -> findRatingsBySourceAndStatus + auth-service user lookup |
| POST | `/admin-core-service/rating/get-source-ratings-admin` | `RatingController#getSourceRatingsAdmin` | RatingService.getRatingsForSourceExcludingDeleted -> findBySourceTypeAndSourceIdAndStatusNotIn + auth-service user lookup |

### admin-core-service: Custom report run (read-only transaction, SELECT only)

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/admin-core-service/v1/reports/custom/run` | `CustomReportController#run` | CustomReportService.run is @Transactional(readOnly=true); validated spec -> jdbc.query SELECT; scope/setting reads only |

### admin-core-service: Sub-organisation team list

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/admin-core-service/sub-org/v1/team/list` | `SubOrgTeamController#listTeamMembers` | SubOrgTeamService.listTeamMembers: FacultySubjectPackageSessionMappingRepository.findDistinctUserIdsBySubOrgIdAndLinkage + POST auth-service … |

### admin-core-service: Subjects by id

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/admin-core-service/subject/v1/subjects-by-ids` | `SubjectController#getSubjectsByIds` | SubjectService.getSubjectsByIds: SubjectRepository.findAllByIdIn only |

### admin-core-service: System files: lists

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/admin-core-service/system-files/v1/list` | `SystemFileController#getSystemFiles` | SystemFileService.getSystemFilesByAccess (@Transactional readOnly, @Cacheable): EntityAccessRepository/SystemFileRepository finds + auth-service user-details-list read |
| POST | `/admin-core-service/system-files/v1/my-files` | `SystemFileController#getMyFiles` | SystemFileService.getMyFiles (@Transactional readOnly): EntityAccessRepository/SystemFileRepository finds + auth-service user-details-list read |

### admin-core-service: Tags: learner counts and lookups by tag

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/admin-core-service/tag-management/institutes/*/tags/user-counts` | `TagController#getUserCountsByTags` | TagService.getUserCountsByTags: TagRepository find + UserTagRepository.getUserCountPerSpecificTags |
| POST | `/admin-core-service/tag-management/institutes/*/tags/users` | `TagController#getUsersByTags` | TagService.getUserIdsByTags: TagRepository.findActiveTagsByIdsAndInstituteId + UserTagRepository.findUserIdsByTagIdsAndInstituteId (no user attribute/institute access … |
| POST | `/admin-core-service/tag-management/institutes/*/tags/users/details` | `TagController#getUserDetailsByTags` | TagService.getUserDetailsByTags: tag + user-tag finds + InstituteStudentRepository.findStudentDetailsByUserIds (returns learner details as JSON, unpaged) |

### admin-core-service: Call dashboard: call search and disposition counts

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/admin-core-service/v1/telephony/calls/dispositions/counts` | `CallDashboardController#dispositionCounts` | CallSearchService.dispositionCounts: jdbc.query + CallDispositionOptionsService.filterOptions (listForInstituteWithoutSeeding, AiAgentRepository find, jdbc.queryForList) |
| POST | `/admin-core-service/v1/telephony/calls/search` | `CallDashboardController#search` | CallSearchService.search: jdbc.queryForObject/query only, cached lead-report settings, scope resolver reads, auth-service user-details-list read; numbers masked unless … |

### admin-core-service: Lead timeline: batched journey and latest notes

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/admin-core-service/timeline/v1/student/journey-batch` | `TimelineEventController#getJourneyBatch` | LeadJourneyBatchService.journeyBatch (@Transactional readOnly): timeline + TelephonyCallLogRepository + LeadFollowupRepository finds, auth-service user-details-list read |
| POST | `/admin-core-service/timeline/v1/student/latest-notes-batch` | `TimelineEventController#getLatestNotesBatch` | TimelineEventService.getLatestNotesForStudents (@Transactional readOnly): TimelineEventRepository.findRecentPerStudent*/countByStudentUserIds* only |

### admin-core-service: Payments and memberships: paged logs and dashboard summaries

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/admin-core-service/v1/user-plan/all` | `UserPlanController#getUserPlans` | UserPlanService.getUserPlansByUserIdAndInstituteId (@Transactional readOnly): UserPlanRepository.findByUserIdAndInstituteIdWithFilters + InstituteRepository finds |
| POST | `/admin-core-service/v1/user-plan/membership-details` | `UserPlanController#getMembershipDetails` | UserPlanService.getMembershipDetails (@Transactional readOnly): UserPlanRepository.findMembershipDetailsWithDynamicStatus/findByIdsWithoutPaymentLogs + auth-service … |
| POST | `/admin-core-service/v1/user-plan/payment-logs` | `UserPlanController#getPaymentLogs` | PaymentLogService.getPaymentLogsForInstitute: PaymentLogRepository.findCombinedPaymentLogIdsPaginated/findPaymentLogsWithRelationshipsByIds, … |
| POST | `/admin-core-service/v1/user-plan/payment-logs/billing-summary` | `UserPlanController#getBillingSummary` | PaymentLogService.getBillingSummary: UserPlanRepository.getBillingSummary only |
| POST | `/admin-core-service/v1/user-plan/payment-logs/collection-summary` | `UserPlanController#getCollectionSummary` | PaymentLogService.getCollectionSummary: PaymentLogRepository.getCollectionSummary only |
| POST | `/admin-core-service/v1/user-plan/payment-logs/dashboard` | `PaymentDashboardController#getDashboard` | PaymentDashboardService.getDashboard: PaymentDashboardRepository aggregates + PaymentLogService.getBillingSummary + UserPlanRepository.getUpcomingByMonth |
| POST | `/admin-core-service/v1/user-plan/payment-logs/instalment-forecast` | `UserPlanController#getInstalmentForecast` | PaymentLogService.getInstalmentForecast: UserPlanRepository.getInstalmentProgress/getUpcomingByMonth only |
| POST | `/admin-core-service/v1/user-plan/payment-logs/learner-plan-breakdown` | `UserPlanController#getLearnerPlanBreakdown` | PaymentLogService.getLearnerPlanBreakdown: UserPlanRepository.findLearnerPlanBreakdown only |
| POST | `/admin-core-service/v1/user-plan/payment-logs/outstanding-learners` | `UserPlanController#getOutstandingLearners` | PaymentLogService.getOutstandingLearners: UserPlanRepository.findLearnersDueInMonth/findLearnersWithBalance/findOutstandingLearners + auth-service user-details-list read |
| POST | `/admin-core-service/v1/user-plan/payment-logs/summary` | `UserPlanController` | PaymentLogService summary: aggregateCombinedPaymentGroups/Logs, findDistinctPaymentPlanNames, findUsedPaymentModes, SELECTs only |

### admin-core-service: Workflows: list with schedules

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/admin-core-service/v1/workflow/institute/workflows-with-schedules/list` | `WorkflowController#getWorkflowsWithSchedules` | WorkflowService.getWorkflowsWithSchedulesPaged -> workflowRepository.findWorkflowsWithSchedulesPage (paged select); access guard only logs |

### admin-core-service: Workflow runs: list

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/admin-core-service/v1/workflow-execution/list` | `WorkflowExecutionController#getWorkflowExecutions` | WorkflowExecutionService.getWorkflowExecutions is @Transactional(readOnly=true) -> findWorkflowExecutionsWithFilters (paged select) |

### assessment-service: Assessments: admin list, participants, leaderboard, reports, dashboard

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/assessment-service/assessment/admin-participants/all/respondent-list` | `AdminAssessmentGetParticipantsController#respondentList` | AssessmentParticipantsManager.getRespondentList -> assessmentUserRegistrationRepository.findRespondentListForAssessmentWithFilter* (select) |
| POST | `/assessment-service/assessment/admin/assessment-admin-list-filter` | `AdminAssessmentGetController#assessmentAdminListFilter` | AdminAssessmentGetManager.assessmentAdminListFilter -> assessmentRepository.filterAssessments (paged select); note: no institute check in controller/manager |
| POST | `/assessment-service/assessment/admin/dashboard/insights` | `AssessmentDashboardController#getInsights` | AssessmentDashboardService.getDashboard -> AssessmentDashboardQueries.find* (JdbcTemplate selects) + admin-core internal enrollments-by-package-sessions read + … |
| POST | `/assessment-service/assessment/admin/get-leaderboard` | `AdminAssessmentGetController#assessmentLeaderBoard` | AdminAssessmentGetManager.getLeaderBoard -> studentAttemptRepository.findLeaderBoardForAssessmentAndInstituteId* (select); note: no institute check |
| POST | `/assessment-service/assessment/admin/get-student-report` | `AdminAssessmentGetController#studentReport` | AdminAssessmentGetManager.getStudentReport -> studentAttemptRepository.findAssessmentForUserWithFilter* (select); note: no institute check |
| POST | `/assessment-service/assessment/manual-evaluation/attempts/file-status` | `AdminManualEvaluationController#getAttemptsFileStatus` | EvaluationAccessValidator.attemptsInInstitute (findIdsInInstitute) + AdminManualEvaluationManager.getAttemptsFileStatus -> studentAttemptRepository.findAllById; reads … |

### assessment-service: Question bank: filter

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/assessment-service/question-bank/v1/questions/filter` | `GetQuestionBankController#filterQuestions` | GetQuestionBankManager.getQuestions -> libraryTreeResolver.withDescendants + questionRepository.findQuestionsByFilters (selects); returns questions with solutions |

### assessment-service: Question library: filter

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/assessment-service/question-library/v1/questions/filter` | `QuestionLibraryController#listQuestions` | QuestionLibraryService.listQuestions -> QuestionLibraryScope.of (selects) + GetQuestionBankManager.getQuestions + nodeRepository.find*/count* (selects) |

### assessment-service: Question papers: filter

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/assessment-service/question-paper/public/view/v1/get-with-filters` | `GetPublicQuestionPaperBankController#getQuestionPapers` | GetPublicQuestionPaperManager.getQuestionPapers -> questionPaperRepository.findPublicQuestionPapersByFilters (paged select) |
| POST | `/assessment-service/question-paper/view/v1/get-with-filters` | `GetQuestionPaperBankController#getQuestionPapers` | GetQuestionPaperManager.getQuestionPapers -> questionPaperRepository.findQuestionPapersByFilters (paged select) |

### auth-service: Session: the demo user renews its own access token

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/auth-service/v1/refresh-token` | `AuthController#refreshToken` | renews the demo user's own access token; AuthManager.refreshToken reads the refresh token + roles and signs a JWT, no row is written |

### auth-service: Users: names and avatars by id

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/auth-service/v1/user-details/get-basic-details` | `UserDetailController#getUserBasicDetails` | UserDetailService.getUserBasicDetails -> userRepository.findAllById; returns id, name, face file id only. Note: no institute check on the ids |

### auth-service: Team list (passwords left out for the demo user)

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/auth-service/v1/user-roles/users-of-status` | `RoleController#getUsersOfStatus` | UserService.getUsersByInstituteIdAndStatusPaged = paged SELECTs. `hidePasswordsCallerMayNotSee` sets every row's password to null when `DemoReadOnlyGate.isDemoCaller` is true |

### community-service: Tags and entities filter

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/community-service/get-entity` | `GetEntityByFilters#getFilteredEntityTags` | FilterEntityService.getFilteredEntityTags -> repository.findDistinctEntities* + question/questionPaper findById (selects) |

### notification-service: Messaging analytics queries

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/notification-service/analytics/completion-cohort` | `AnalyticsController#getCompletionCohort` | DailyParticipationService.getCompletionCohort -> notificationLogRepository.getCompletionCohort/getTotalCompletedUsers selects + by-phones lookup. Note: no user/institute … |
| POST | `/notification-service/analytics/daily-participation` | `AnalyticsController#getDailyParticipation` | DailyParticipationService.getDailyParticipation -> templateDayMapRepository metric selects. Note: controller has no user/institute check at all |
| POST | `/notification-service/analytics/engagement-leaderboard` | `AnalyticsController#getEngagementLeaderboard` | DailyParticipationService.getEngagementLeaderboard -> notificationLogRepository selects + admin-core internal users/by-phones lookup. Note: no user/institute check; … |
| POST | `/notification-service/analytics/lead-journey-funnel` | `AnalyticsController#getLeadJourneyFunnel` | LeadJourneyFunnelService.getFunnel -> notificationLogRepository.findJourneyOutgoingLogs/findRepliedPhones selects. Note: no user/institute check; returns a per-recipient … |

### notification-service: Chat: batch search

| Method | Path | Controller method | Evidence |
|---|---|---|---|
| POST | `/notification-service/v1/chat/batches/search` | `ChatConversationController#searchBatches` | ChatBatchService.search -> settings select + admin-core faculty/package-sessions and package-sessions/search (reads) + convRepo.findBy... (select); does not provision |

ai_service has no allowed non-GET request: every POST, PUT, PATCH and DELETE made with the demo user's token is
refused there. (The admin app reads AI credit estimates with GET.)

## Notable non-GET routes that are refused

These look like reads by name or are used by read screens, and are **not** on the list.

| Method | Path | Why it is refused |
|---|---|---|
| POST | `/admin-core-service/institute/institute_learner/get/v1/all-csv` | whole-list CSV export of learners |
| POST | `/admin-core-service/institute/institute_learner/get/v1/basic-details-csv` | CSV of learners with username and password |
| POST | `/auth-service/v1/user/users-credential` | returns usernames and passwords |
| POST | `/notification-service/v1/chat/people/search` | forwards the caller's token to `users-of-status`, which is refused |
| POST | `/admin-core-service/institute/v1/certificate/learner/get` | named "get" but generates, stores and notifies when a certificate is missing |
| POST | `/admin-core-service/open/v1/catalogue-resources/download` | saves a download-analytics row |
| POST | `/admin-core-service/v1/oauth/meta/session/*/pages/resolve` | calls Meta and saves a page token |
| POST | `/admin-core-service/api/v1/hr/reports/bank-export` | uploads a file of staff bank details and saves an export log |
| POST | `/admin-core-service/v1/telephony/calls/export` | CSV/XLSX of call logs with phone numbers |
| POST | `/admin-core-service/learner-management/export/*` | PDF exports of learner and batch reports |
| POST | `/assessment-service/assessment/export/{csv,pdf}/*` | unpaged participant and respondent files |
| POST | `/admin-core-service/v1/perf/rum` | browser timing beacon; buffered and written to `perf_rum_minute` by a scheduled flush. The app sends it in the background, so the demo shows failed beacons in the network tab only |
| POST | `/notification-service/v1/tracking/log` | saves a log row and can trigger engagement messages |
| POST | `/notification-service/v1/chat/conversations/direct, /batch/*` | get-or-create: inserts a conversation on first call |
| POST | `/media-service/public/v1/short-link/get-or-create` | inserts a short link on first call |
| POST | `*preview* endpoints (invoice, invoice numbering, fee, counsellor reassign/assign, returns, pay, learner home, reporting, announcement recipients, pen preview, panel pair)` | read-only today, but each shares code with the write beside it (a server-side dry-run flag, `persist=false`) or renders caller-supplied config; left out as fragile |
| POST | `/auth-service/v1/login-root, /login-otp, learner logins` | sign-in sends no bearer token, so it never meets the gate and keeps working. With the demo token attached it is refused. Each sign-in deletes that user's earlier refresh tokens |
| POST | `/auth-service/v1/user-operation/update-password, /send-passwords` | password change |
| POST, PUT | `/auth-service/v1/user-details/update, /update-user` | profile edit |
| POST, PUT, DELETE | `/auth-service/v1/user-roles/*, /v1/user-invitation/*, /v1/institute/*/roles, /v1/user-permission` | roles, invitations, permissions |
| POST, DELETE | `/admin-core-service/**/api-keys, /ai-service/institute/api-keys/*, /ai-service/api-keys/v1/*` | API key creation and revocation |
| POST | `/ai-service/mcp/oauth/txn/*/decision (and the other MCP consent POSTs)` | MCP / OAuth consent. A stored token replayed by the MCP server is refused as well (`mcp/principal.py`) |

The full verdict for each of the 214 candidates:

<details><summary>122 candidates not on the list</summary>

| Verdict | Method | Path | Controller method | Reason |
|---|---|---|---|---|
| WRITES | POST | `/admin-core-service/ai-plans/v1/checkout` | `AiPlansStorefrontController#checkout` | AiSubscriptionBillingService.checkout creates charge + payment link/autopay registration (payments.createLinkForCharge … |
| WRITES | POST | `/admin-core-service/api/v1/hr/attendance/check-in` | `AttendanceController#checkIn` | AttendanceService.checkIn attendanceRecordRepository.save (hr_attendance/service/AttendanceService.java:159) |
| WRITES | POST | `/admin-core-service/api/v1/hr/attendance/check-out` | `AttendanceController#checkOut` | AttendanceService.checkOut attendanceRecordRepository.save (hr_attendance/service/AttendanceService.java:216) |
| WRITES | POST | `/admin-core-service/api/v1/hr/reports/bank-export` | `ReportsController#generateBankExport` | @Auditable; BankExportService uploads a file with staff bank account numbers + net pay and saves an export log (fileStorageService.uploadBytes … |
| EXCLUDED | POST | `/admin-core-service/api/v1/hr/teaching/pay/preview` | `HrTeachingController#previewPay` | preview endpoint (shares code with the write path or renders caller-supplied config) |
| WRITES | PUT | `/admin-core-service/batch/v1/sub-org-associated` | `BatchController#setSubOrgAssociated` | PackageSessionRepository.saveAll: packages/service/BatchService.java:92 |
| EXCLUDED | POST | `/admin-core-service/commerce/v1/pos/returns/preview` | `PosSaleController#previewReturn` | preview endpoint (shares code with the write path or renders caller-supplied config) |
| EXCLUDED | POST | `/admin-core-service/commerce/v1/returns/preview` | `CommerceReturnController#preview` | preview endpoint (shares code with the write path or renders caller-supplied config) |
| WRITES | PUT | `/admin-core-service/coupon/v1/update-status` | `CouponCodeController#updateCouponCodeStatus` | couponCodeRepository.save user_subscription/service/CouponCodeService.java:201; getOrGenerateShortUrl may create short URL :163 and save :171 |
| WRITES | POST | `/admin-core-service/course/v1/update-course-details/{instituteId}` | `CourseController#updateCourse` | @Auditable; CourseService.addOrUpdateCourse -> packageService.addOrUpdatePackage (course/service/CourseService.java:499) |
| WRITES | POST | `/admin-core-service/enquiry/v1/admin/update-status` | `EnquiryInternalController#bulkUpdateEnquiryStatus` | @Auditable; EnquiryService.bulkUpdateEnquiryStatus enquiryRepository.saveAll (enquiry/service/EnquiryService.java:385) + timeline events [tsv name … |
| WRITES | POST | `/admin-core-service/institute/institute_learner-operation/v1/update` | `InstituteStudentOperationController#updateStudentStatus` | @Auditable; StudentSessionManager.updateStudentStatus runs @Modifying updates (institute_learner/manager/StudentSessionManager.java:54) |
| WRITES | POST | `/admin-core-service/institute/institute_learner/get/v1/all-csv` | `InstituteGetStudentController#getStudentsCsvExport` | No DB write, but EXPORT: loops every page and returns the whole learner list as a CSV file (bulk personal data) … |
| WRITES | POST | `/admin-core-service/institute/institute_learner/get/v1/basic-details-csv` | `InstituteGetStudentController#getStudentsBasicDetailsCsvExport` | No DB write, but EXPORT: CSV file of all learners with username + PASSWORD fetched from auth-service users-credential … |
| ALLOWED 2026-11-20 (password left out for the demo user) | POST | `/admin-core-service/institute/institute_learner/get/v2/all` | `StudentGetV2Controller#getLinkedStudentsV2` | No DB write found (SELECTs + SET LOCAL plan_cache_mode, StudentListManager.java:518), BUT every row is enriched with the learner password from … |
| WRITES | POST | `/admin-core-service/institute/learner-batch/v1/approve-learner-request` | `LearnerBatchController#approveLearnerRequest` | LearnerBatchEnrollService.shiftLearnerFromPendingForApprovalToActivePackageSessions shifts batch, triggers enrollment workflow, referral benefits … |
| WRITES | POST | `/admin-core-service/institute/learner-batch/v1/approve-learner-request-bulk` | `LearnerBatchController#approveLearnerRequestBulk` | LearnerBatchEnrollService.processBulkLearnerApproval loops the same shift/enrol path (institute_learner/service/LearnerBatchEnrollService.java:383) |
| WRITES | POST | `/admin-core-service/institute/v1/certificate/learner/get` | `InstituteCertificateController#generateCourseCertification` | Named "get" but writes on every path: generates + stores certificate, saves mapping and notifies when missing or body regenerate=true … |
| WRITES | POST | `/admin-core-service/institute/v1/faculty/assign-subjects-and-batches` | `FacultyController#assignFacultyToSubjectsAndBatches` | FacultyService.addFacultyToSubjectsAndBatches facultyRepository.saveAll (faculty/service/FacultyService.java:65) |
| WRITES | PUT | `/admin-core-service/institute/v1/faculty/update-assign-subjects-and-batches` | `FacultyController#updateAssignFacultyToSubjectsAndBatches` | FacultyService.updateFacultyAssignmentsToSubjects facultyRepository.saveAll (faculty/service/FacultyService.java:118) |
| WRITES | POST | `/admin-core-service/instructor-copilot/v1/create` | `InstructorCopilotController#createLog` | InstructorCopilotService.createLog repository.save (instructor_copilot/service/InstructorCopilotService.java:42) |
| WRITES | PUT | `/admin-core-service/internal/learner/v1/update` | `InternalLearnerDetailController#updateLearnerDetail` | LearnerService.updateLearnerDetail saves Student: learner/service/LearnerService.java:194 (and :243); also pushes profile to external LMS over HTTP … |
| WRITES | PUT | `/admin-core-service/learner-invitation/update-learner-invitation-status` | `LearnerInvitationController#updateLearnerInvitationStatus` | LearnerInvitationRepository.saveAll: learner_invitation/services/LearnerInvitationService.java:122 |
| WRITES | POST | `/admin-core-service/learner-management/export/batch-report` | `LmsReportExportController#getLearnerProgressReport` | EXPORT, no DB write: LmsReportExportService.generateLmsReport (learner_reports/service/LmsReportExportService.java:37) returns a PDF attachment with … |
| UNSURE | POST | `/admin-core-service/learner-management/export/chapter-wise-batch-report` | `LmsReportExportController#downloadChapterWiseBatchReport` | No DB write found (LmsReportExportService.generateChapterWiseBatchReport: repo SELECTs + in-process PDF); returns batch-level PDF file export |
| UNSURE | POST | `/admin-core-service/learner-management/export/chapter-wise-learners-report` | `LmsReportExportController#downloadChapterWiseLearnersReport` | No DB write found (reuses generateModuleProgressReport); returns PDF file for one learner |
| UNSURE | POST | `/admin-core-service/learner-management/export/learner-module-progress-report` | `LmsReportExportController#downloadSubjectWiseProgress` | No DB write found (LmsReportExportService.generateModuleProgressReport: repo SELECTs + in-process PDF); returns PDF file for one learner (query … |
| UNSURE | POST | `/admin-core-service/learner-management/export/learner-report` | `LmsReportExportController#downloadLearnerReport` | No DB write/external call found (LmsReportExportService.generateLearnerReport: repo SELECTs + in-process PDF), but returns a PDF file attachment of … |
| UNSURE | POST | `/admin-core-service/learner-management/export/learner-subject-wise-report` | `LmsReportExportController#downloadSubjectWiseProgress` | Body-dependent: with user_id -> one learner PDF, without -> batch subject-wise PDF (LmsReportExportController.java:57); no DB write found, but output … |
| WRITES | POST | `/admin-core-service/learner-tracking/activity-log/assignment-slide/grade` | `AssignmentSlideActivityLogController#gradeAssignment` | AssignmentSlideTrackedRepository.save: learner_tracking/service/AssignmentSlideActivityLogService.java:156 |
| WRITES | POST | `/admin-core-service/learner-tracking/activity-log/quiz-slide/save-question-feedback` | `QuizSlideActivityLogController#saveQuizQuestionFeedback` | QuizSlideQuestionTrackedRepository.save: learner_tracking/service/QuizSlideActivityLogService.java:429 |
| WRITES | POST | `/admin-core-service/learner-tracking/offline-sync/v1/batch` | `OfflineSyncController#batch` | OfflineSyncService.processBatch replays learner tracking events: ActivityLogRepository.save learner_tracking/service/LearnerTrackingService.java:185 … |
| WRITES | PUT | `/admin-core-service/learner/info/v1/edit` | `LearnerUserInfoController#editLearnerDetails` | LearnerService.editLearnerDetails saves Student: learner/service/LearnerService.java:81; authService.updateUser :89 |
| WRITES | POST | `/admin-core-service/live-sessions/provider/zoom/accounts` | `ZoomAccountController#create` | ZoomAccountService.create -> ZoomAccountStore.create saves provider config: live_session/provider/service/zoom/ZoomAccountService.java:86 … |
| WRITES | PUT | `/admin-core-service/live-sessions/provider/zoom/accounts/{id}` | `ZoomAccountController#update` | ZoomAccountService.update -> store.update: live_session/provider/service/zoom/ZoomAccountService.java:116 (ZoomAccountStore.java:99); evicts token … |
| WRITES | POST | `/admin-core-service/lms-report-setting/institute/update/{instituteId}` | `LmsReportSettingController#updateInstituteReportSettings` | NotificationSettingRepository.save: learner_reports/service/LMSReportSettingService.java:82 |
| WRITES | POST | `/admin-core-service/lms-report-setting/learner/update` | `LmsReportSettingController#updateLearnerReportSettings` | addOrUpdateLmsReportSetting -> NotificationSettingRepository.save: learner_reports/service/LMSReportSettingService.java:82 (called from :87) |
| WRITES | POST | `/admin-core-service/open/ai-calling/v1/batches` | `PublicAiCallingApiController#createBatch` | AiCallingApiService.createBatch: callRepository.save telephony/publicapi/AiCallingApiService.java:260, queueService.enqueue :281 - places real AI … |
| WRITES | POST | `/admin-core-service/open/commerce/v1/checkout` | `PublicCommerceCheckoutController#checkout` | CommerceCheckoutService.placeOrder allocates order number + writes order (commerce/order/checkout/CommerceCheckoutService.java:334) |
| WRITES | POST | `/admin-core-service/open/v1/audience/lead/submit-catalogue` | `PublicAudienceController#submitCatalogueLead` | AudienceService.submitCatalogueLead creates lead: audienceResponseRepository.save (audience/service/AudienceService.java:846) |
| WRITES | POST | `/admin-core-service/open/v1/catalogue-resources/download` | `PublicCatalogueResourceController#download` | Despite the name it only records a download-analytics row: CatalogueResourceDownloadService.record repository.save … |
| WRITES | POST | `/admin-core-service/planning-logs/v1/create` | `PlanningLogController#createPlanningLogs` | TeacherPlanningLogRepository.save: planning_logs/service/PlanningLogService.java:99; @CacheEvict |
| WRITES | POST | `/admin-core-service/public/catalogue-review/v1/submit` | `PublicCatalogueReviewController#submit` | CatalogueReviewService.submit repository.save (catalogue_review/service/CatalogueReviewService.java:124) |
| EXCLUDED | POST | `/admin-core-service/reporting/v1/preview` | `ReportingController#preview` | preview endpoint (shares code with the write path or renders caller-supplied config) |
| WRITES | POST | `/admin-core-service/slide/v1/content-history/restore` | `SlideContentHistoryController#restore` | SlideContentHistoryService.restore: slideRepository.save slide/service/SlideContentHistoryService.java:103, chapterToSlidesRepository.save :108, … |
| WRITES | PUT | `/admin-core-service/slide/v1/update-status` | `SlideController#updateSlideStatus` | SlideService.updateSlideStatus: chapterToSlidesRepository.save slide/service/SlideService.java:325, slideRepository.save :329, sends learner … |
| WRITES | POST | `/admin-core-service/super-admin/v1/institutes/{instituteId}/settings/history/{historyId}/restore` | `SuperAdminInstituteSettingController#restoreSetting` | InstituteSettingAdminService.restore -> settingWriter.putSettingKey (capabilities/service/InstituteSettingAdminService.java:205) |
| WRITES | POST | `/admin-core-service/teacher/course-approval/v1/submit-for-review` | `TeacherCourseApprovalController#submitForReview` | CourseApprovalService.submitForReview packageRepository.save (course/service/CourseApprovalService.java:139) |
| WRITES | POST | `/admin-core-service/teacher/course-approval/v1/withdraw-from-review` | `TeacherCourseApprovalController#withdrawFromReview` | CourseApprovalService.withdrawFromReview packageRepository.save (course/service/CourseApprovalService.java:199) |
| WRITES | POST | `/admin-core-service/v1/audience/user-lead-profile/update-status` | `AudienceController#updateLeadStatus` | @Auditable; UserLeadProfileService.updateConversionStatus saveAndFlush (audience/service/UserLeadProfileService.java:270) + timeline event |
| WRITES | PUT | `/admin-core-service/v1/catalog-api/settings` | `CatalogApiSettingsController#put` | repository.save(row) in controller (catalog_api/settings/CatalogApiSettingsController.java:76) |
| WRITES | POST | `/admin-core-service/v1/catalogue-blog/post/archive` | `CatalogueBlogController#archive` | CatalogueBlogService.setStatus repository.save (catalogue_blog/service/CatalogueBlogService.java:177) |
| WRITES | POST | `/admin-core-service/v1/catalogue-blog/post/publish` | `CatalogueBlogController#publish` | CatalogueBlogService.setStatus repository.save (catalogue_blog/service/CatalogueBlogService.java:177) |
| WRITES | POST | `/admin-core-service/v1/catalogue-blog/post/unpublish` | `CatalogueBlogController#unpublish` | CatalogueBlogService.setStatus repository.save (catalogue_blog/service/CatalogueBlogService.java:177) |
| WRITES | POST | `/admin-core-service/v1/catalogue-review/review/status` | `CatalogueReviewController#setStatus` | CatalogueReviewService.setStatus repository.save (catalogue_review/service/CatalogueReviewService.java:209) |
| EXCLUDED | POST | `/admin-core-service/v1/counsellor-workbench/assign/preview` | `CounsellorWorkbenchController#previewAssign` | preview endpoint (shares code with the write path or renders caller-supplied config) |
| EXCLUDED | POST | `/admin-core-service/v1/counsellor-workbench/reassign/preview` | `CounsellorWorkbenchController#previewReassign` | preview endpoint (shares code with the write path or renders caller-supplied config) |
| WRITES | POST | `/admin-core-service/v1/course-catalogue/revision/discard-draft` | `CourseCatalogueController#discardDraft` | CatalogueRevisionService.discardDraft revisionRepository.save (course_catalogue/service/CatalogueRevisionService.java:248) |
| WRITES | POST | `/admin-core-service/v1/course-catalogue/revision/publish` | `CourseCatalogueController#publishDraft` | CatalogueRevisionService.publish saves revision + catalogue (course_catalogue/service/CatalogueRevisionService.java:201) |
| WRITES | POST | `/admin-core-service/v1/course-catalogue/revision/save-draft` | `CourseCatalogueController#saveDraft` | CatalogueRevisionService.saveDraft revisionRepository.save (course_catalogue/service/CatalogueRevisionService.java:135) |
| EXCLUDED | POST | `/admin-core-service/v1/fee-management/admission-package/{packageId}/record-offline-payment/preview` | `AdmissionPackageController#previewPayment` | preview endpoint (shares code with the write path or renders caller-supplied config) |
| EXCLUDED | POST | `/admin-core-service/v1/fee-management/user-plan/{userPlanId}/cpo-discount/preview` | `CpoSideViewController#previewCpoDiscount` | preview endpoint (shares code with the write path or renders caller-supplied config) |
| EXCLUDED | POST | `/admin-core-service/v1/invoices/admin/preview` | `InvoiceController#previewAdminInvoice` | preview endpoint (shares code with the write path or renders caller-supplied config) |
| EXCLUDED | POST | `/admin-core-service/v1/invoices/numbering/preview` | `InvoiceNumberingController#preview` | preview endpoint (shares code with the write path or renders caller-supplied config) |
| WRITES | POST | `/admin-core-service/v1/lead-status` | `LeadStatusController#create` | @Auditable; LeadStatusService.create leadStatusRepository.save (audience/service/LeadStatusService.java:125) |
| WRITES | POST | `/admin-core-service/v1/lead-status/lead/{audienceResponseId}` | `LeadStatusController#setLeadStatus` | @Auditable; LeadStatusService.changeLeadStatus saves lead + history (audience/service/LeadStatusService.java:244) |
| WRITES | POST | `/admin-core-service/v1/lead-status/leads/bulk` | `LeadStatusController#setLeadStatusBulk` | @Auditable; BulkLeadStatusService.changeStatusBulk loops leadStatusService.changeLeadStatus (audience/service/BulkLeadStatusService.java:126) |
| WRITES | PUT | `/admin-core-service/v1/lead-status/{id}` | `LeadStatusController#update` | @Auditable; LeadStatusService.update leadStatusRepository.save (audience/service/LeadStatusService.java:164) [input tsv method name … |
| EXCLUDED | POST | `/admin-core-service/v1/learner-home/admin/preview` | `LearnerHomeAdminController#preview` | preview endpoint (shares code with the write path or renders caller-supplied config) |
| WRITES | POST | `/admin-core-service/v1/oauth/meta/session/{sessionKey}/pages/resolve` | `MetaOAuthController#resolvePageById` | Calls Meta Graph API with stored user token, stores encrypted page token + extends session expiry: stateRepository.save … |
| WRITES | POST | `/admin-core-service/v1/perf/rum` | `PerfRumController#report` | Telemetry ingest: PerfRumService.record buffers samples in memory, @Scheduled flush batch-INSERTs into perf_rum_minute: … |
| WRITES | POST | `/admin-core-service/v1/product-page/coupon/create` | `ProductPageController#createCoupon` | CouponCodeRepository.save product_page/service/ProductPageService.java:494; AppliedCouponDiscountRepository.save :508 |
| WRITES | POST | `/admin-core-service/v1/product-page/{productPageId}/custom-fields/add` | `ProductPageController#addCustomField` | customFieldService.addOrUpdateCustomField: product_page/service/ProductPageService.java:265 |
| WRITES | POST | `/admin-core-service/v1/product-page/{productPageId}/custom-fields/create` | `ProductPageController#createCustomField` | creates + links custom field, customFieldService.addOrUpdateCustomField: product_page/service/ProductPageService.java:405 |
| WRITES | PUT | `/admin-core-service/v1/product-page/{productPageId}/custom-fields/order` | `ProductPageController#reorderCustomFields` | reorders via customFieldService.addOrUpdateCustomField: product_page/service/ProductPageService.java:363 |
| WRITES | POST | `/admin-core-service/v1/telephony/calls/export` | `CallDashboardController#export` | EXPORT, no DB write: CallDashboardController.export (telephony/controller/CallDashboardController.java:385) streams CSV/XLSX of the filtered call … |
| WRITES | POST | `/admin-core-service/v1/telephony/calls/{callLogId}/disposition` | `CallDashboardController#disposition` | CallDispositionService.applyDisposition: callLogRepo.save telephony/core/CallDispositionService.java:157 (also seeds catalog :97, syncs lead status) |
| WRITES | POST | `/admin-core-service/v1/telephony/inbound/status` | `InboundCallController#status` | Provider webhook (Exotel/Plivo status): updates TelephonyCallLog telephony/core/CallLogService.java:106, billing/credits, timeline event, recording + … |
| WRITES | POST | `/admin-core-service/v1/user-plan/payment-logs/update-tracking` | `UserPlanController#updatePaymentLogTracking` | paymentLogRepository.save user_subscription/service/PaymentLogService.java:2578 (and :2591); @Auditable writes an audit row |
| WRITES | POST | `/assessment-service/assessment/basic/create/v1/submit` | `AssessmentBasicDetailsController#saveBasicAssessmentDetails` | Creates/updates an assessment: assessmentRepository.save + audit record; … |
| EXCLUDED | POST | `/assessment-service/assessment/copy-intake/v1/submitted/preview` | `CopyIntakeController#previewSubmitted` | preview endpoint (shares code with the write path or renders caller-supplied config) |
| EXCLUDED | POST | `/assessment-service/assessment/evaluation-ai/pen-preview` | `AiEvaluationController#penPreview` | preview endpoint (shares code with the write path or renders caller-supplied config) |
| WRITES | PUT | `/assessment-service/assessment/evaluation-ai/review/{processId}/question/{questionId}` | `AiEvaluationController#overrideQuestion` | Overrides a question's marks/feedback: questionEvaluationRepository.save; … |
| WRITES | POST | `/assessment-service/assessment/export/ai-assessment-report/analyse-copies` | `AdminExportController#analyseCheckedCopies` | Starts AI analysis and spends AI credits: copyCheckReportDataSender.sendNow + adminCoreServiceClient.processCopyCheckAnalyses; … |
| WRITES | POST | `/assessment-service/assessment/export/csv/registered-participants` | `AdminExportController#getRegisteredCsv` | No DB write, but returns ALL registered participants (PII + marks, unpaged) as a CSV file = bulk personal data export; … |
| WRITES | POST | `/assessment-service/assessment/export/csv/respondent-list` | `AdminExportController#getRespondentListCsv` | No DB write, but returns full respondent list as a CSV file = bulk personal data export; … |
| WRITES | POST | `/assessment-service/assessment/export/pdf/registered-participants` | `AdminExportController#getRegisteredPdf` | No DB write, but returns full participant list as a PDF file = bulk personal data export; … |
| WRITES | POST | `/assessment-service/assessment/export/pdf/respondent-list` | `AdminExportController#getRespondentListPdf` | No DB write, but returns full respondent list as a PDF file = bulk personal data export; … |
| WRITES | POST | `/assessment-service/assessment/export/reports/zip/assemble` | `AdminExportController#assembleReportZipExport` | Assembles/uploads the ZIP and updates the job: reportExportJobRepository.save; … |
| WRITES | POST | `/assessment-service/assessment/export/reports/zip/cancel` | `AdminExportController#cancelReportZipExport` | Cancels the export job: reportExportJobRepository.save; … |
| WRITES | POST | `/assessment-service/assessment/export/reports/zip/continue` | `AdminExportController#continueReportZipExport` | Claims and advances the export job (renders reports): reportExportJobRepository.save; … |
| WRITES | POST | `/assessment-service/assessment/export/reports/zip/initiate` | `AdminExportController#initiateReportZipExport` | Creates a report ZIP export job: reportExportJobRepository.save; … |
| WRITES | POST | `/assessment-service/assessment/report-profile/v1/link` | `ReportProfileController#link` | ReportProfileService.link -> jdbc.update DELETE/INSERT assessment_report_profile_link; … |
| WRITES | POST | `/assessment-service/assessment/report-profile/v1/save` | `ReportProfileController#save` | ReportProfileService.save -> jdbc.update UPDATE/INSERT assessment_report_profile; … |
| WRITES | POST | `/assessment-service/question-paper/manage/v1/mark-status` | `AddQuestionPaperController#markStatusOfQuestionPaper` | @Modifying UPDATE institute_question_paper SET status; … |
| WRITES | POST | `/auth-service/internal/v1/login-codes` | `LoginCodeInternalController#create` | Mints a learner login code: codeRepository.save; … |
| EXCLUDED | POST | `/auth-service/internal/v1/user-roles/users-of-status` | `RoleInternalController#getUsersOfRole` | internal HMAC route, not a user route |
| WRITES | POST | `/auth-service/learner/v1/login` | `LearnerAuthController#authenticateAndGetToken` | Learner login: deletes refresh tokens, mints refresh token + JWT; … |
| WRITES | POST | `/auth-service/learner/v1/login-otp` | `LearnerAuthController#loginViaOtp` | Learner OTP login: deletes refresh tokens, mints tokens, userSessionService.createSession; … |
| WRITES | POST | `/auth-service/open/v1/login-codes` | `LoginCodeOpenController#create` | Mints a learner login code: codeRepository.save; … |
| WRITES | POST | `/auth-service/public/v1/panel/session/login-password` | `PanelPublicController#loginPassword` | Panel password login: starts a panel session row and mints session token; … |
| WRITES | POST | `/auth-service/v1/login-otp` | `AuthController#loginViaOtp` | OTP login: verifies OTP, deletes refresh tokens, mints refresh token + JWT; … |
| WRITES | POST | `/auth-service/v1/login-root` | `AuthController#authenticateAndGetToken` | Login: deletes all refresh tokens then mints refresh token + JWT; … |
| EXCLUDED | POST | `/auth-service/v1/panel/pair/preview` | `PanelTeacherController#pairPreview` | preview endpoint (shares code with the write path or renders caller-supplied config) |
| WRITES | POST | `/auth-service/v1/user-details/update` | `UserDetailController#updateUserDetails` | Updates a user's details and roles: userRepository.save + updateRolesOfUser; … |
| WRITES | PUT | `/auth-service/v1/user-details/update-user` | `UserDetailController#updateUser` | Updates username/password/profile: userCredentialUpdateService.updateCredentials + userService.updateUserDetails; … |
| WRITES | PUT | `/auth-service/v1/user-roles/update-role-status` | `RoleController#updateUserRoleStatus` | Changes users' role status: userRoleRepository.updateUserRoleStatusByInstituteIdAndUserId; … |
| ALLOWED 2026-11-20 (password left out for the demo user) | POST | `/auth-service/v1/user-roles/users-of-status` | `RoleController#getUsersOfStatus` | No write (UserService.getUsersByInstituteIdAndStatusPaged = paged selects) BUT each row carries the member's PLAINTEXT password … |
| UNSURE | POST | `/auth-service/v1/user/users-credential` | `UserController#getUsersCredentials` | No write (UserService.getUsersCredentials = findAllById) BUT returns username + PLAINTEXT password for every id the caller may manage … |
| WRITES | POST | `/auth-service/v1/verify-generic-whatsapp-otp-login` | `AuthController#verifyGenericWhatsAppOtpAndLogin` | Verifies WhatsApp OTP then generateJwtResponse: deletes refresh tokens, mints refresh token + JWT; … |
| EXCLUDED | POST | `/auth-service/v1/vimotion/invite-codes/validate` | `VimotionAuthController#validateInviteCode` | not part of the admin app |
| WRITES | POST | `/auth-service/v1/vimotion/login` | `VimotionAuthController#login` | Vimotion login: deletes refresh tokens, mints refresh token + JWT; … |
| WRITES | POST | `/auth-service/v1/vimotion/waitlist/join` | `VimotionWaitlistController#join` | Adds a waitlist entry: waitlistRepository.save; auth_service/src/main/java/vacademy/io/auth_service/feature/vimotion/service/WaitlistService.java:114 |
| WRITES | POST | `/media-service/acknowledge-get-details` | `FileController#acknowledgeUploadAndGetDetails` | Acknowledges an upload (acknowledgeClientUpload) and copies the object to the public bucket; … |
| WRITES | POST | `/media-service/get-signed-url` | `FileController#uploadFile` | Creates a presigned S3 upload URL and a file_metadata row: s3Client.generatePresignedUrl + fileMetadataRepository.save; … |
| WRITES | POST | `/media-service/public/get-signed-url` | `PublicFileController#uploadFile` | Creates a presigned S3 upload URL and a file_metadata row: s3Client.generatePresignedUrl + fileMetadataRepository.save; … |
| WRITES | POST | `/media-service/public/v1/short-link/get-or-create` | `PublicShortLinkGatewayController#getOrCreateShortLink` | Get-or-create: inserts a short link when none exists; media_service/src/main/java/vacademy/io/media_service/service/ShortLinkService.java:44 … |
| EXCLUDED | POST | `/notification-service/v1/announcements/recipients/preview` | `AnnouncementController#previewRecipients` | preview endpoint (shares code with the write path or renders caller-supplied config) |
| WRITES | POST | `/notification-service/v1/chat/conversations/batch/{packageSessionId}` | `ChatConversationController#openBatch` | Get-or-provision: creates the batch conversation / member row: convRepo.saveAndFlush; … |
| WRITES | POST | `/notification-service/v1/chat/conversations/direct` | `ChatConversationController#startOrGetDirect` | Get-or-create: creates the direct conversation and its two member rows: convRepo.saveAndFlush + saveMember; … |
| EXCLUDED | POST | `/notification-service/v1/chat/people/search` | `ChatPeopleController#searchPeople` | forwards the caller token to auth users-of-status, which is denied |
| WRITES | POST | `/notification-service/v1/tracking/log` | `TrackingController#logEvent` | Saves a tracking row and may trigger engagement messages: notificationLogRepository.save + engagementTriggerService.checkAndTriggerEngagement; … |

</details>

## GETs refused for the demo user (Java: 40 entries)

GET passes by default, so these are refused by name. `*` is one path segment, `**` any remainder; "query" means the entry applies only when the query string contains that word.

| Path | Why |
|---|---|
| `/auth-service/v1/user/user-credentials/*` | Credentials: stored passwords, sign-in links or tokens for other users |
| `/admin-core-service/admin/learner-portal/v1/access` | Credentials: stored passwords, sign-in links or tokens for other users |
| `/admin-core-service/parent-link/v1/export-credentials` | Credentials: stored passwords, sign-in links or tokens for other users |
| `/admin-core-service/learner/lms/v1/landing` | Credentials: stored passwords, sign-in links or tokens for other users |
| `/community-service/super-admin/v1/onboarding/demo-accounts` | Credentials: stored passwords, sign-in links or tokens for other users |
| `/admin-core-service/admin/learner-portal/v1/send-cred` | Sends a message |
| `/admin-core-service/assignment-ai-evaluation/v1/latest` | Sends a message |
| `/admin-core-service/v1/engagement/template-proposals/brief-check` | Spends AI credits |
| `/assessment-service/assessment/export/pdf/ai-student-report` | Spends AI credits |
| `/assessment-service/assessment/export/pdf/ai-assessment-report` | Spends AI credits |
| `/assessment-service/assessment/learner/report/ai-pdf` | Spends AI credits |
| `/admin-core-service/live-sessions/provider/meeting/join` | Live classes: creates or starts meetings, writes attendance, returns host links and SDK tokens |
| `/admin-core-service/live-sessions/provider/meeting/google-meet-join` | Live classes: creates or starts meetings, writes attendance, returns host links and SDK tokens |
| `/admin-core-service/live-sessions/provider/meeting/zoom-join-payload` | Live classes: creates or starts meetings, writes attendance, returns host links and SDK tokens |
| `/admin-core-service/live-sessions/provider/meeting/zoom-sdk-signature` | Live classes: creates or starts meetings, writes attendance, returns host links and SDK tokens |
| `/admin-core-service/live-sessions/provider/meeting/session-links` | Live classes: creates or starts meetings, writes attendance, returns host links and SDK tokens |
| `/admin-core-service/live-session/guest/bbb-join` | Live classes: creates or starts meetings, writes attendance, returns host links and SDK tokens |
| `/admin-core-service/payments/user-plan/*/status/*` | Payment status poll that can mark a payment paid and enrol |
| `/admin-core-service/commerce/v1/invoices/*/pdf` | Creates and stores a document, a page or a record on first read |
| `/admin-core-service/commerce/v1/credit-notes/*/pdf` | Creates and stores a document, a page or a record on first read |
| `/admin-core-service/api/v1/hr/payslips/*/download` | Creates and stores a document, a page or a record on first read |
| `/admin-core-service/v1/invoices/*/download` | Creates and stores a document, a page or a record on first read |
| `/admin-core-service/v1/invoices/institute/*/bulk-download` | Creates and stores a document, a page or a record on first read |
| `/admin-core-service/credits/packs/invoices` | Creates and stores a document, a page or a record on first read |
| `/admin-core-service/v1/student-analysis/report/*/pdf` | Creates and stores a document, a page or a record on first read |
| `/admin-core-service/v1/referral-link/member` | Creates and stores a document, a page or a record on first read |
| `/admin-core-service/mentorship/v1/my-booking-page` | Creates and stores a document, a page or a record on first read |
| `/admin-core-service/scorm/tracking/v1/*/initialize` | Creates and stores a document, a page or a record on first read |
| `/admin-core-service/engagement/learner/v1/feed` | Learner engagement: opening the feed or an item writes points and attempts |
| `/admin-core-service/engagement/learner/v1/item/*` | Learner engagement: opening the feed or an item writes points and attempts |
| `/admin-core-service/v1/audience/campaign/*/communications` | Syncs with an outside system and saves the result |
| `/admin-core-service/v1/marketing/oauth/session/*/options` | Syncs with an outside system and saves the result |
| `/admin-core-service/institute/white-label/v1/status` | Syncs with an outside system and saves the result |
| `/admin-core-service/commerce/v1/products/export` | Exports that also write an audit row |
| `/admin-core-service/commerce/v1/redirects/export` | Exports that also write an audit row |
| `/admin-core-service/commerce/v1/audit` (query `format`) | Exports that also write an audit row |
| `/admin-core-service/commerce/v1/reports/*` (query `format`) | Exports that also write an audit row |
| `/assessment-service/assessment/manual-evaluation/get/attempt-data` (query `markevaluating`) | Reads unless a flag in the query asks for a write |
| `/assessment-service/scheduler/test/update-attempt` | Runs a scheduled job by hand |
| `/community-service/super-admin/v1/app-registry/providers/**` | Super-admin store sync (the demo user is not a super admin; refused here as well) |

### ai_service (9 patterns, relative to `/ai-service`)

| Path | Why |
|---|---|
| `/ai/lecture/generate-plan`, `/ai/lecture/generate-feedback` | legacy GET endpoints that start a model run |
| `/ai/get-question-pdf/**`, `/ai/get-question-audio/**` | PDF, image and audio to questions: model runs started by GET |
| `/ai/chat-with-pdf/get-response` | generates one model answer per call |
| `/tts/**` | speech synthesis (`GET /tts/v1/speak` takes any text and needs no sign-in) |
| `/assistant/session/*/stream`, `/chat-agent/session/*/stream`, `/chat-agent/session/*/updates` | streams and polls of model output for a staff chat |

Also in ai_service: the two web sockets (`/tutor/ws/{id}`, `/chat-agent/session/{id}/voice`) authenticate with
`decode_access_token`, which returns nothing for the demo user, so both close with "authentication required";
the MCP server refuses a stored demo token (`mcp/principal.py`).

## GETs found that are NOT refused

Listed so the choice is visible. None of these lets a visitor change institute data through the demo token.

### Default seeding, status sync and bookkeeping on read (left open: screens depend on them)

| Path | What the read does |
|---|---|
| every authenticated request | `JwtAuthFilter` stamps last-login, writes a `user_activity_log` row and updates the session row. Refused requests return before this |
| `/admin-core-service/v1/lead-status`, `/v1/lead-tier`, `/v1/telephony/calls/dispositions` | first read for an institute inserts the default rows. Seed the demo institute with them so no visitor triggers it |
| `/admin-core-service/v1/audience/user-lead-profile` | recomputes and saves the lead's derived profile (no AI) |
| `/admin-core-service/coupon/v1/by-source`, `/by-code`, `/by-source-id` | a coupon without a short link gets one created and saved |
| `/admin-core-service/v1/telephony/ai-agents/assist/jobs/*`, `/assessment-service/assessment/export/reports/zip/status`, `/auth-service/v1/panel/my-session` | a stale job or session is marked failed/ended |
| `/admin-core-service/v1/oauth/meta/connectors/*/health`, `/live-sessions/provider/meeting/attendance`, `/notification-service/v1/email-verification/*/status/*` | calls the outside provider with stored credentials and saves the refreshed status or token |
| `/admin-core-service/lms/v1/connection-health` | probes the institute's connected LMS sites (no write); `force=true` skips the one-minute cache |
| `/media-service/get-public-url`, `/get-all-templates` | a file that exists only in the private bucket is copied to the public bucket. `/media-service/public/get-public-url` does the same with no sign-in at all, so refusing it for the demo user would protect nothing and break every image |
| `/auth-service/v1/panel/partner/customers`, `/community-service/super-admin/v1/onboarding/submissions/*` | backfill / first-open stamp; not reachable by an institute admin |

### Bulk exports of personal data (reads; left open)

The demo institute holds seeded data only. If that ever changes, refuse these.

| Path | Content |
|---|---|
| `/admin-core-service/v1/live-activity/export.csv` | up to 50,000 activity rows with name, email, mobile |
| `/admin-core-service/audit/v1/logs/export.csv` | admin activity log |
| `/admin-core-service/ai-usage/v1/logs`, `/conversations/all`, `/messages` | up to 50,000 rows of AI usage and chat messages |
| `/admin-core-service/engagement/admin/v1/item/*/tracking/export`, `/plan/*/overview/export` | per-learner engagement tracking |
| `/admin-core-service/api/v1/hr/compliance/**/download`, `/hr/compliance/wps`, `/hr/reports/bank-export/*/download`, `/erp/finance/**` | payroll, statutory and finance files (bank details, PAN) |
| `/admin-core-service/commerce/v1/stock/movements/export` | stock movements |
| `/assessment-service/assessment/export/{csv,pdf}/leaderboard`, `/marks-rank` | whole-assessment result files |
| `/community-service/engage/admin/*/leaderboard/csv` | live quiz leaderboard |
| `/ai-service/credits/v2/institutes/*/usage-events/export`, `/ai-service/tutor/v1/insights/export.csv` | AI usage and tutor insight files |
| single-record PDFs (one invoice, credit note, challan, Form 16, learner report, email attachment) | one document each, rendered in memory |
| signed download links (`/media-service/get-details/ids` and ten more, invoice and receipt URL reads, call recording URL) | time-limited file access, no upload link |

### Not user-token routes (out of scope for this gate; named because they change things on GET)

| Path | Auth | What it does |
|---|---|---|
| `/admin-core-service/open/test` | **none** | leftover debug route: runs the workflow `wf_ld_group_sync` with fixed data on every hit |
| `/admin-core-service/open/learner/enroll-invite` | none | fires the `INVITE_FORM_FILL` workflow on every read of an available invite |
| `/admin-core-service/open/payments/*/status/*` | none | PhonePe branch polls the gateway and marks the payment paid or failed (the signed-in twin `/payments/user-plan/*/status/*` is refused for the demo user) |
| `/admin-core-service/open/v1/sub-org-registration/kyc/status` | none | polls the KYC provider and saves the result |
| OAuth callbacks (`/v1/oauth/meta/callback`, `/v1/marketing/oauth/{meta,google}/callback`, `/youtube/oauth/callback`, `/live-sessions/provider/{zoom,google}/oauth/callback`) | state id | exchange the code and store the connection |
| `/admin-core-service/live-sessions/provider/meeting/bbb-callback` | none on the handler | saves the schedule, lowers the server's active-meeting count |
| telephony webhooks over GET (`/v1/telephony/webhook/status`, `/inbound/route`, `/inbound/status`, `/plivo/**`) | shared secret in the query | update call logs and bill call credits |
| `/admin-core-service/live-presenter/v1/*`, `/live-learner/v1/*`, `/community-service/engage/{admin,learner}/*` | none / presenter key | in-memory live-session state |
| `/s/{shortCode}`, `/s/{shortCode}/info` | none | stamps last-queried on the short link |
| `/admin-core-service/open/ai-calling/v1/**`, `/open/commerce/v1/**`, `/open/catalog/v1/**`, `/site`, `/courses/**`, `/learning-paths/**`, `/sitemap`, `/uploads/*`, `/submissions/*/checked-copy` | institute API key | stamp the key's last-used time; `/open/commerce/v1/me/orders` issues order access tokens |
| `/auth-service/v1/internal/user`, `/v1/internal/generate-token-for-learner`, `/internal/user/by-email`, `/internal/user/user-by-id-with-password`, `/admin-core-service/internal/enrollment-credentials/text`, `/internal/engagement/v1/learner-snapshot` | service signature (`InternalAuthFilter`) | activity log; tokens and stored passwords for any user |

The shared filter still applies to these when the demo token is attached (a non-GET is refused), but anyone can
call the no-auth ones with no token at all.

## Known gaps

- 654 of the 1,510 GET routes were judged safe by a static call tracer only. It does not follow calls on lambda
  parameters or long call chains, and it does not see an entity changed inside a transaction without a `save`.
- The read verdicts for non-GET routes stop at service boundaries: a call into auth-service or admin-core from
  another service was judged by the route it calls, not traced again on the far side.
- ai_service GETs were reviewed by reading the route list and the handlers named above, not each of the 238.
- New routes are not covered automatically: a new POST is refused (safe), a new GET that writes is allowed until
  someone adds it here.
