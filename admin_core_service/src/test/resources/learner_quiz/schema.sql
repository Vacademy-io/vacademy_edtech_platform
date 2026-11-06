-- Columns and primary keys of the tables quiz grading touches, read from the production
-- schema with no rows. Generated; see LearnerQuizAttemptPostgresTest.

CREATE TABLE IF NOT EXISTS slide (
  "id" varchar(255) NOT NULL,
  "source_id" varchar(255),
  "source_type" varchar(255),
  "title" varchar(255),
  "image_file_id" varchar(255),
  "description" text,
  "created_at" timestamp without time zone DEFAULT now(),
  "updated_at" timestamp without time zone DEFAULT now(),
  "status" varchar(255),
  "last_sync_date" timestamp without time zone,
  "parent_id" varchar(255),
  "created_by_user_id" varchar(255),
  "drip_condition_json" text,
  "updated_by_user_id" varchar(255),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS quiz_slide (
  "id" varchar(255) NOT NULL,
  "description" varchar(255),
  "title" varchar(255),
  "created_at" timestamp without time zone DEFAULT now(),
  "updated_at" timestamp without time zone DEFAULT now(),
  "time_limit_in_minutes" integer,
  "marks_per_question" numeric DEFAULT 1.0 NOT NULL,
  "negative_marking" numeric DEFAULT 0.0 NOT NULL,
  "pass_percentage" double precision,
  "re_attempt_count" integer,
  "partial_marking" boolean DEFAULT false NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS quiz_slide_question (
  "id" varchar NOT NULL,
  "parent_rich_text_id" varchar,
  "text_id" varchar,
  "explanation_text_id" varchar,
  "media_id" varchar,
  "status" varchar,
  "question_response_type" varchar NOT NULL,
  "question_type" varchar NOT NULL,
  "access_level" varchar NOT NULL,
  "auto_evaluation_json" text,
  "evaluation_type" varchar,
  "question_order" integer,
  "quiz_slide_id" varchar,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  "can_skip" boolean DEFAULT true,
  "marks" numeric DEFAULT NULL::numeric,
  "negative_marking" numeric DEFAULT NULL::numeric,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS quiz_slide_question_options (
  "id" varchar NOT NULL,
  "quiz_slide_question_id" varchar NOT NULL,
  "text_id" varchar,
  "explanation_text_id" varchar,
  "media_id" varchar,
  "created_on" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  "updated_on" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS rich_text_data (
  "id" varchar(255) NOT NULL,
  "type" varchar(255) NOT NULL,
  "content" text NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS rich_text_translation (
  "id" varchar(255) NOT NULL,
  "rich_text_id" varchar(255) NOT NULL,
  "locale" varchar(10) NOT NULL,
  "type" varchar(255),
  "content" text NOT NULL,
  "state" varchar(20) DEFAULT 'DRAFT'::character varying NOT NULL,
  "source_locale" varchar(10) DEFAULT 'en'::character varying NOT NULL,
  "source_hash" varchar(64),
  "translated_by" varchar(255),
  "reviewed_by" varchar(255),
  "created_at" timestamp without time zone DEFAULT now(),
  "updated_at" timestamp without time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS activity_log (
  "id" varchar(255) NOT NULL,
  "source_id" varchar(255),
  "source_type" varchar(255),
  "start_time" timestamp without time zone,
  "end_time" timestamp without time zone,
  "user_id" varchar(255),
  "slide_id" varchar(255),
  "percentage_watched" numeric,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  "status" varchar(50),
  "raw_json" text,
  "processed_json" text,
  "engaged_ms" bigint,
  "last_seen_at" timestamp with time zone,
  "processing_attempts" integer DEFAULT 0 NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS quiz_slide_question_tracked (
  "id" varchar(255) NOT NULL,
  "response_json" text,
  "response_status" varchar(255),
  "question_id" varchar(255),
  "activity_id" varchar(255) NOT NULL,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  "instructor_feedback" text,
  "instructor_feedback_file_id" varchar(255),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS chapter_to_slides (
  "id" varchar(255) NOT NULL,
  "chapter_id" varchar(255),
  "slide_id" varchar(255),
  "slide_order" integer,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  "status" varchar(255),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS chapter_package_session_mapping (
  "id" varchar NOT NULL,
  "chapter_id" varchar NOT NULL,
  "package_session_id" varchar NOT NULL,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  "status" varchar(50),
  "chapter_order" integer,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS student_session_institute_group_mapping (
  "user_id" varchar(255),
  "package_session_id" varchar(255),
  "institute_id" varchar(255),
  "group_id" varchar(255),
  "enrolled_date" date,
  "status" varchar(255),
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "institute_enrollment_number" varchar,
  "id" varchar NOT NULL,
  "expiry_date" timestamp without time zone,
  "destination_package_session_id" varchar(255),
  "user_plan_id" varchar(255),
  "automated_completion_certificate_file_id" varchar(255),
  "type_id" varchar(100),
  "type" varchar(100),
  "source" varchar(100),
  "desired_level_id" varchar(255),
  "desired_package_id" varchar(255),
  "comma_separated_org_roles" text,
  "sub_org_id" varchar(255),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS package_session (
  "id" varchar(255) NOT NULL,
  "level_id" varchar(255),
  "session_id" varchar(255),
  "start_time" date,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp without time zone DEFAULT now() NOT NULL,
  "status" varchar(255),
  "package_id" varchar(255),
  "group_id" varchar(255),
  "enrollment_policy_settings" text,
  "is_org_associated" boolean DEFAULT false,
  "available_slots" integer DEFAULT 0,
  "max_seats" integer,
  "version" bigint DEFAULT 0,
  "is_parent" boolean DEFAULT false,
  "parent_id" varchar(255),
  "name" varchar(255),
  "content_copied_by" varchar(20),
  "content_copied_from_package_session_id" varchar(255),
  "created_by_user_id" varchar(255),
  "updated_by_user_id" varchar(255),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS package (
  "id" varchar(255) NOT NULL,
  "package_name" varchar(255),
  "status" varchar(50) NOT NULL,
  "created_by_user_id" varchar(255),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS package_institute (
  "package_id" varchar(255),
  "group_id" varchar(255),
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "institute_id" varchar NOT NULL,
  "id" varchar NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS institutes (
  "id" varchar(255) NOT NULL,
  "name" varchar(255) NOT NULL,
  "address_line" varchar(255),
  "pin_code" varchar(255),
  "mobile_number" varchar(255),
  "logo_file_id" varchar(255),
  "language" varchar(255),
  "institute_theme_code" varchar(255),
  "website_url" varchar(255),
  "description" text,
  "founded_date" date,
  "type" varchar(255),
  "held" varchar(255),
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "country" varchar(255),
  "state" varchar(255),
  "city" varchar(255),
  "email" varchar(255),
  "letterhead_file_id" varchar(255),
  "cover_media_id" varchar(511),
  "subdomain" text,
  "cover_image_file_id" varchar(255),
  "cover_text_json" text,
  "setting_json" text,
  "learner_portal_base_url" varchar(255) DEFAULT 'learner.vacademy.io'::character varying,
  "teacher_portal_base_url" varchar(255) DEFAULT 'teacher.vacademy.io'::character varying,
  "admin_portal_base_url" varchar(255) DEFAULT 'dash.vacademy.io'::character varying,
  "board" varchar(255),
  "gst_details" text,
  "affiliation_number" varchar(255),
  "staff_strength" integer,
  "school_strength" integer,
  "lead_tag" varchar(50) DEFAULT 'PROD'::character varying,
  "account_type" varchar(32),
  "product" varchar(32) DEFAULT 'vacademy'::character varying NOT NULL,
  "company_size" varchar(32),
  "currency" varchar(3),
  "gstin" varchar(15),
  "state_code" varchar(2),
  "demo_expires_at" timestamp without time zone,
  "source_quote_id" varchar(255),
  "live_session_base_url" varchar(255),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS question_slide (
  "id" varchar(255) NOT NULL,
  "text_id" varchar(50) NOT NULL,
  "media_id" varchar(999),
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  "question_response_type" varchar(50) NOT NULL,
  "question_type" varchar(50) NOT NULL,
  "access_level" varchar(50) NOT NULL,
  "auto_evaluation_json" text,
  "evaluation_type" varchar(50),
  "explanation_text_id" varchar(50),
  "default_question_time_mins" integer,
  "parent_rich_text_id" varchar(255),
  "points" integer,
  "re_attempt_count" integer,
  "source_type" varchar(255),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS video_slide_question (
  "id" varchar NOT NULL,
  "parent_rich_text_id" varchar,
  "text_id" varchar,
  "explanation_text_id" varchar,
  "media_id" varchar,
  "status" varchar,
  "question_response_type" varchar NOT NULL,
  "question_type" varchar NOT NULL,
  "access_level" varchar NOT NULL,
  "auto_evaluation_json" text,
  "evaluation_type" varchar,
  "question_order" integer,
  "question_time_in_millis" bigint,
  "video_slide_id" varchar,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  "can_skip" boolean DEFAULT true,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS concentration_score (
  "id" varchar(255) NOT NULL,
  "concentration_score" double precision NOT NULL,
  "tab_switch_count" integer NOT NULL,
  "pause_count" integer NOT NULL,
  "answer_times_in_sec" int4[],
  "activity_id" varchar(255) NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS assignment_slide_tracked (
  "id" varchar(255) NOT NULL,
  "comma_separated_file_ids" text,
  "activity_id" varchar(255) NOT NULL,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  "marks" double precision,
  "feedback" text,
  "checked_file_id" varchar(255),
  "late_submission" boolean DEFAULT false NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS assessment_slide_tracked (
  "id" varchar(255) NOT NULL,
  "activity_id" varchar(255) NOT NULL,
  "attempt_id" varchar(255),
  "comma_separated_file_ids" text,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS audio_tracked (
  "id" varchar(255) NOT NULL,
  "activity_id" varchar(255),
  "start_time" timestamp without time zone,
  "end_time" timestamp without time zone,
  "playback_speed" double precision,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS document_tracked (
  "id" varchar(255) NOT NULL,
  "activity_id" varchar(255),
  "start_time" timestamp without time zone,
  "end_time" timestamp without time zone,
  "page_number" integer,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS question_slide_tracked (
  "id" varchar(255) NOT NULL,
  "attempt_number" integer,
  "response_json" text,
  "response_status" varchar(255),
  "marks" double precision,
  "activity_id" varchar(255) NOT NULL,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS video_slide_question_tracked (
  "id" varchar NOT NULL,
  "response_json" text,
  "response_status" text,
  "activity_id" varchar(255) NOT NULL,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS video_tracked (
  "id" varchar(255) NOT NULL,
  "activity_id" varchar(255),
  "start_time" timestamp without time zone,
  "end_time" timestamp without time zone,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
);

ALTER TABLE activity_log ADD CONSTRAINT activity_log_slide_id_fkey FOREIGN KEY (slide_id) REFERENCES slide(id);
ALTER TABLE quiz_slide_question_tracked ADD CONSTRAINT fk_activity_id FOREIGN KEY (activity_id) REFERENCES activity_log(id);
