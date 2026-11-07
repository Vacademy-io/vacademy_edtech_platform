/**
 * Pre-built sample email templates for each use-case.
 * When user clicks "Use sample template", we create this in their template library
 * so the SEND_EMAIL handler can look it up by name.
 *
 * i18n note: `name` stays untranslated on purpose — it's used as a business key
 * (MESSAGE_TEMPLATE_EXISTS lookup + creation) sent to the backend, not just display
 * text, so localizing it would fragment dedupe across languages. `subject` and
 * `html` are genuine recipient-facing content and ARE translated below.
 *
 * The `{{placeholder}}` tokens (fullName, instituteName, …) are NOT i18next
 * interpolation — they're resolved later by the SEND_EMAIL handler. Every
 * translated string that embeds one is rendered through `tt()`, which passes an
 * identity map ({ fullName: '{{fullName}}', … }) as the interpolation data so
 * i18next substitutes the token right back in verbatim (and translators are free
 * to reposition it for their language's word order).
 */

import type { TFunction } from 'i18next';

export interface SampleEmailTemplate {
  name: string;
  subject: string;
  html: string;
  variables: string[];
}

/** Identity interpolation map so `{{var}}` tokens embedded in a translation pass through unchanged. */
function ph(vars: string[]): Record<string, string> {
  return Object.fromEntries(vars.map((v) => [v, `{{${v}}}`]));
}

/** Map of use-case template ID → sample email template, built with a live `t`. */
export function buildSampleTemplates(t: TFunction): Record<string, SampleEmailTemplate> {
  const tt = (key: string, vars: string[]) => t(key, ph(vars));
  const footer = (vars: string[] = ['instituteName']) => tt('common.footer', vars);

  return {

  // ─── Enrollment ───

  email_batch_students: {
    name: 'Batch Notification',
    subject: tt('emailBatchStudents.subject', ['fullName']),
    variables: ['fullName', 'email', 'instituteName'],
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#ffffff">
  <h2 style="color:#1a1a1a;margin-bottom:16px">${tt('emailBatchStudents.greeting', ['fullName'])}</h2>
  <p style="color:#444;line-height:1.6">${t('emailBatchStudents.body1')}</p>
  <p style="color:#444;line-height:1.6">${t('emailBatchStudents.body2')}</p>
  <p style="color:#888;font-size:13px;margin-top:32px">${footer()}</p>
</div>`,
  },

  welcome_enrolled_student: {
    name: 'Welcome - New Student',
    subject: tt('welcomeEnrolledStudent.subject', ['fullName']),
    variables: ['fullName', 'username', 'password', 'email', 'instituteName'],
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#ffffff">
  <div style="text-align:center;padding:24px 0">
    <h1 style="color:#2563eb;margin:0">${t('welcomeEnrolledStudent.heroTitle')}</h1>
  </div>
  <h2 style="color:#1a1a1a">${tt('welcomeEnrolledStudent.greeting', ['fullName'])}</h2>
  <p style="color:#444;line-height:1.6">${t('welcomeEnrolledStudent.body1')}</p>

  <div style="background:#f0f9ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px 20px;margin:20px 0">
    <p style="margin:0 0 10px 0;color:#1e40af;font-weight:600;font-size:14px">${t('welcomeEnrolledStudent.credentialsHeading')}</p>
    <p style="margin:4px 0;color:#1e293b;font-size:14px"><strong>${t('welcomeEnrolledStudent.usernameLabel')}</strong> ${tt('welcomeEnrolledStudent.usernameValue', ['username'])}</p>
    <p style="margin:4px 0;color:#1e293b;font-size:14px"><strong>${t('welcomeEnrolledStudent.passwordLabel')}</strong> ${tt('welcomeEnrolledStudent.passwordValue', ['password'])}</p>
    <p style="margin:10px 0 0 0;color:#64748b;font-size:12px">${t('welcomeEnrolledStudent.credentialsNote')}</p>
  </div>

  <p style="color:#444;line-height:1.6">${t('welcomeEnrolledStudent.nextStepsIntro')}</p>
  <ul style="color:#444;line-height:1.8">
    <li>${t('welcomeEnrolledStudent.step1')}</li>
    <li>${t('welcomeEnrolledStudent.step2')}</li>
    <li>${t('welcomeEnrolledStudent.step3')}</li>
  </ul>
  <p style="color:#444;line-height:1.6">${t('welcomeEnrolledStudent.body2')}</p>
  <p style="color:#888;font-size:13px;margin-top:32px">${footer()}</p>
</div>`,
  },

  email_parents_batch: {
    name: 'Parent Notification',
    subject: tt('emailParentsBatch.subject', ['fullName']),
    variables: ['fullName', 'email', 'parentsEmail', 'instituteName'],
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#ffffff">
  <h2 style="color:#1a1a1a">${t('emailParentsBatch.greeting')}</h2>
  <p style="color:#444;line-height:1.6">${tt('emailParentsBatch.body1', ['fullName'])}</p>
  <p style="color:#444;line-height:1.6">${t('emailParentsBatch.body2')}</p>
  <p style="color:#888;font-size:13px;margin-top:32px">${footer()}</p>
</div>`,
  },

  termination_notice: {
    name: 'Membership Removal Notice',
    subject: tt('terminationNotice.subject', ['fullName']),
    variables: ['fullName', 'email', 'instituteName'],
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#ffffff">
  <h2 style="color:#1a1a1a">${tt('terminationNotice.greeting', ['fullName'])}</h2>
  <p style="color:#444;line-height:1.6">${t('terminationNotice.body1')}</p>
  <p style="color:#444;line-height:1.6">${t('terminationNotice.body2')}</p>
  <p style="color:#888;font-size:13px;margin-top:32px">${footer()}</p>
</div>`,
  },

  // ─── Audience / CRM ───

  audience_lead_confirmation: {
    name: 'Lead Confirmation',
    subject: tt('audienceLeadConfirmation.subject', ['parentName']),
    variables: ['parentName', 'email', 'instituteName'],
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#ffffff">
  <div style="text-align:center;padding:24px 0">
    <h1 style="color:#16a34a;margin:0">${t('audienceLeadConfirmation.heroTitle')}</h1>
  </div>
  <h2 style="color:#1a1a1a">${tt('audienceLeadConfirmation.greeting', ['parentName'])}</h2>
  <p style="color:#444;line-height:1.6">${t('audienceLeadConfirmation.body1')}</p>
  <p style="color:#444;line-height:1.6">${t('audienceLeadConfirmation.body2')}</p>
  <p style="color:#888;font-size:13px;margin-top:32px">${footer()}</p>
</div>`,
  },

  lead_followup_email: {
    name: 'Lead Follow-up',
    subject: tt('leadFollowupEmail.subject', ['parentName']),
    variables: ['parentName', 'email', 'instituteName'],
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#ffffff">
  <h2 style="color:#1a1a1a">${tt('leadFollowupEmail.greeting', ['parentName'])}</h2>
  <p style="color:#444;line-height:1.6">${t('leadFollowupEmail.body1')}</p>
  <p style="color:#444;line-height:1.6">${t('leadFollowupEmail.body2')}</p>
  <ul style="color:#444;line-height:1.8">
    <li>${t('leadFollowupEmail.item1')}</li>
    <li>${t('leadFollowupEmail.item2')}</li>
    <li>${t('leadFollowupEmail.item3')}</li>
  </ul>
  <p style="color:#444;line-height:1.6">${t('leadFollowupEmail.body3')}</p>
  <p style="color:#888;font-size:13px;margin-top:32px">${footer()}</p>
</div>`,
  },

  // ─── Payment ───

  payment_failed_email: {
    name: 'Payment Failed Alert',
    subject: tt('paymentFailedEmail.subject', ['fullName']),
    variables: ['fullName', 'email', 'instituteName'],
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#ffffff">
  <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin-bottom:24px">
    <h2 style="color:#dc2626;margin:0 0 8px 0">${t('paymentFailedEmail.bannerTitle')}</h2>
    <p style="color:#991b1b;margin:0">${t('paymentFailedEmail.bannerBody')}</p>
  </div>
  <p style="color:#444;line-height:1.6">${t('paymentFailedEmail.greetingLabel')} <strong>${tt('paymentFailedEmail.greetingName', ['fullName'])}</strong>,</p>
  <p style="color:#444;line-height:1.6">${t('paymentFailedEmail.body1')}</p>
  <p style="color:#444;line-height:1.6"><strong>${t('paymentFailedEmail.nextStepsHeading')}</strong></p>
  <ol style="color:#444;line-height:1.8">
    <li>${t('paymentFailedEmail.step1')}</li>
    <li>${t('paymentFailedEmail.step2')}</li>
    <li>${t('paymentFailedEmail.step3')}</li>
  </ol>
  <p style="color:#444;line-height:1.6">${t('paymentFailedEmail.body2')}</p>
  <p style="color:#888;font-size:13px;margin-top:32px">${footer()}</p>
</div>`,
  },

  abandoned_cart_reminder: {
    name: 'Complete Your Enrollment',
    subject: tt('abandonedCartReminder.subject', ['fullName']),
    variables: ['fullName', 'email', 'instituteName'],
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#ffffff">
  <h2 style="color:#1a1a1a">${tt('abandonedCartReminder.greeting', ['fullName'])}</h2>
  <p style="color:#444;line-height:1.6">${t('abandonedCartReminder.body1')}</p>
  <p style="color:#444;line-height:1.6">${t('abandonedCartReminder.body2')}</p>
  <div style="text-align:center;margin:32px 0">
    <a style="background:#2563eb;color:#ffffff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">${t('abandonedCartReminder.cta')}</a>
  </div>
  <p style="color:#888;font-size:13px">${t('abandonedCartReminder.footNote')}</p>
  <p style="color:#888;font-size:13px;margin-top:32px">${footer()}</p>
</div>`,
  },

  // ─── Live Session ───

  session_start_reminder: {
    name: 'Live Session Starting',
    subject: tt('sessionStartReminder.subject', ['fullName']),
    variables: ['fullName', 'email', 'instituteName'],
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#ffffff">
  <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px;margin-bottom:24px;text-align:center">
    <h2 style="color:#2563eb;margin:0">${t('sessionStartReminder.bannerTitle')}</h2>
  </div>
  <p style="color:#444;line-height:1.6">${t('sessionStartReminder.greetingLabel')} <strong>${tt('sessionStartReminder.greetingName', ['fullName'])}</strong>,</p>
  <p style="color:#444;line-height:1.6">${t('sessionStartReminder.body1')}</p>
  <p style="color:#444;line-height:1.6">${t('sessionStartReminder.body2')}</p>
  <p style="color:#888;font-size:13px;margin-top:32px">${t('sessionStartReminder.signoff')}</p>
</div>`,
  },

  post_session_followup: {
    name: 'Post-Session Follow-up',
    subject: tt('postSessionFollowup.subject', ['fullName']),
    variables: ['fullName', 'email', 'instituteName'],
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#ffffff">
  <h2 style="color:#1a1a1a">${tt('postSessionFollowup.greeting', ['fullName'])}</h2>
  <p style="color:#444;line-height:1.6">${t('postSessionFollowup.body1')}</p>
  <ul style="color:#444;line-height:1.8">
    <li>${t('postSessionFollowup.item1')}</li>
    <li>${t('postSessionFollowup.item2')}</li>
    <li>${t('postSessionFollowup.item3')}</li>
  </ul>
  <p style="color:#444;line-height:1.6">${t('postSessionFollowup.body2')}</p>
  <p style="color:#888;font-size:13px;margin-top:32px">${tt('postSessionFollowup.signoff', ['instituteName'])}</p>
</div>`,
  },

  // ─── Fee Reminder ───

  scheduled_fee_reminder: {
    name: 'Fee Payment Reminder',
    subject: tt('scheduledFeeReminder.subject', ['dueDate']),
    variables: ['studentName', 'recipientName', 'dueDate', 'remainingAmount', 'amountExpected', 'amountPaid', 'installmentNumber', 'reminderType', 'instituteName'],
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#ffffff">
  <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px;margin-bottom:24px">
    <h2 style="color:#d97706;margin:0">${t('scheduledFeeReminder.bannerTitle')}</h2>
  </div>
  <p style="color:#444;line-height:1.6">${t('scheduledFeeReminder.greetingLabel')} <strong>${tt('scheduledFeeReminder.greetingName', ['recipientName'])}</strong>,</p>
  <p style="color:#444;line-height:1.6">${tt('scheduledFeeReminder.body1', ['studentName'])}</p>
  <table style="width:100%;border-collapse:collapse;margin:20px 0">
    <tr style="background:#f8fafc"><td style="padding:10px;border:1px solid #e2e8f0;font-weight:bold;color:#444">${t('scheduledFeeReminder.dueDateLabel')}</td><td style="padding:10px;border:1px solid #e2e8f0;color:#444">${tt('scheduledFeeReminder.dueDateValue', ['dueDate'])}</td></tr>
    <tr><td style="padding:10px;border:1px solid #e2e8f0;font-weight:bold;color:#444">${t('scheduledFeeReminder.totalAmountLabel')}</td><td style="padding:10px;border:1px solid #e2e8f0;color:#444">${tt('scheduledFeeReminder.totalAmountValue', ['amountExpected'])}</td></tr>
    <tr style="background:#f8fafc"><td style="padding:10px;border:1px solid #e2e8f0;font-weight:bold;color:#444">${t('scheduledFeeReminder.alreadyPaidLabel')}</td><td style="padding:10px;border:1px solid #e2e8f0;color:#444">${tt('scheduledFeeReminder.alreadyPaidValue', ['amountPaid'])}</td></tr>
    <tr><td style="padding:10px;border:1px solid #e2e8f0;font-weight:bold;color:#dc2626">${t('scheduledFeeReminder.remainingLabel')}</td><td style="padding:10px;border:1px solid #e2e8f0;color:#dc2626;font-weight:bold">${tt('scheduledFeeReminder.remainingValue', ['remainingAmount'])}</td></tr>
  </table>
  <p style="color:#444;line-height:1.6">${t('scheduledFeeReminder.body2')}</p>
  <p style="color:#888;font-size:13px;margin-top:32px">${footer()}</p>
</div>`,
  },

  // ─── Reports ───

  scheduled_batch_report: {
    name: 'Attendance Report',
    subject: tt('scheduledBatchReport.subject', ['fullName', 'startDate', 'endDate']),
    variables: ['fullName', 'email', 'attendancePercentage', 'sessionsAttended', 'totalSessions', 'startDate', 'endDate', 'sessionsTableHtml', 'totalDurationMinutes', 'instituteName', 'reportUrl'],
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#ffffff">
  <h2 style="color:#1a1a1a">${t('scheduledBatchReport.heading')}</h2>
  <p style="color:#444;line-height:1.6">${tt('scheduledBatchReport.intro', ['fullName', 'startDate', 'endDate'])}</p>
  <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:24px;text-align:center;margin:20px 0">
    <div style="font-size:44px;font-weight:bold;color:#16a34a;line-height:1.2">${tt('scheduledBatchReport.percentValue', ['attendancePercentage'])}%</div>
    <div style="color:#444;margin-top:12px;font-size:14px">${t('scheduledBatchReport.attendanceRateLabel')}</div>
    <div style="color:#666;margin-top:6px;font-size:13px">${tt('scheduledBatchReport.sessionsSummary', ['sessionsAttended', 'totalSessions', 'totalDurationMinutes'])}</div>
  </div>
  <h3 style="color:#1e293b;margin-top:24px">${t('scheduledBatchReport.sessionDetailsHeading')}</h3>
  {{sessionsTableHtml}}
  <div style="text-align:center;margin:24px 0">
    <a href="{{reportUrl}}" style="display:inline-block;background:#2563eb;color:#ffffff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">${t('scheduledBatchReport.cta')}</a>
  </div>
  <p style="color:#444;line-height:1.6;margin-top:16px">${t('scheduledBatchReport.body1')}</p>
  <p style="color:#888;font-size:13px;margin-top:32px">${footer()}</p>
  <p style="border-top:1px solid #e2e8f0;margin-top:24px;padding-top:12px;color:#94a3b8;font-size:11px;line-height:1.5">
    <strong>${t('scheduledBatchReport.concentrationScoreLabel')}</strong> ${t('scheduledBatchReport.concentrationScoreBody')}
  </p>
</div>`,
  },

  scheduled_engagement_summary: {
    name: 'Engagement Summary',
    subject: tt('scheduledEngagementSummary.subject', ['fullName']),
    variables: ['fullName', 'attendancePercentage', 'sessionsAttended', 'totalSessions', 'totalDurationMinutes', 'totalChats', 'totalHandRaises', 'startDate', 'endDate', 'sessionsTableHtml', 'instituteName'],
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#ffffff">
  <h2 style="color:#1a1a1a">${t('scheduledEngagementSummary.heading')}</h2>
  <p style="color:#444;line-height:1.6">${tt('scheduledEngagementSummary.intro', ['fullName'])}</p>
  <table style="width:100%;border-collapse:collapse;margin:20px 0">
    <tr>
      <td style="background:#eff6ff;border-radius:8px;padding:16px;text-align:center;width:25%">
        <div style="font-size:28px;font-weight:bold;color:#2563eb">${tt('scheduledEngagementSummary.percentValue', ['attendancePercentage'])}%</div>
        <div style="color:#64748b;font-size:12px;margin-top:4px">${t('scheduledEngagementSummary.attendanceLabel')}</div>
      </td>
      <td style="width:4%"></td>
      <td style="background:#f0fdf4;border-radius:8px;padding:16px;text-align:center;width:21%">
        <div style="font-size:28px;font-weight:bold;color:#16a34a">${tt('scheduledEngagementSummary.sessionsValue', ['sessionsAttended', 'totalSessions'])}</div>
        <div style="color:#64748b;font-size:12px;margin-top:4px">${t('scheduledEngagementSummary.sessionsLabel')}</div>
      </td>
      <td style="width:4%"></td>
      <td style="background:#fefce8;border-radius:8px;padding:16px;text-align:center;width:21%">
        <div style="font-size:28px;font-weight:bold;color:#ca8a04">${tt('scheduledEngagementSummary.minutesValue', ['totalDurationMinutes'])}</div>
        <div style="color:#64748b;font-size:12px;margin-top:4px">${t('scheduledEngagementSummary.minutesLabel')}</div>
      </td>
      <td style="width:4%"></td>
      <td style="background:#fdf2f8;border-radius:8px;padding:16px;text-align:center;width:21%">
        <div style="font-size:28px;font-weight:bold;color:#db2777">${tt('scheduledEngagementSummary.chatsValue', ['totalChats'])}</div>
        <div style="color:#64748b;font-size:12px;margin-top:4px">${t('scheduledEngagementSummary.chatsLabel')}</div>
      </td>
    </tr>
  </table>
  <h3 style="color:#1e293b;margin-top:24px">${t('scheduledEngagementSummary.sessionDetailsHeading')}</h3>
  {{sessionsTableHtml}}
  <p style="color:#444;line-height:1.6;margin-top:16px">${tt('scheduledEngagementSummary.period', ['startDate', 'endDate'])}</p>
  <p style="color:#888;font-size:13px;margin-top:32px">${tt('scheduledEngagementSummary.signoff', ['instituteName'])}</p>
</div>`,
  },

  scheduled_parents_attendance: {
    name: 'Parent Attendance Update',
    subject: tt('scheduledParentsAttendance.subject', ['fullName', 'startDate', 'endDate']),
    variables: ['fullName', 'attendancePercentage', 'sessionsAttended', 'totalSessions', 'startDate', 'endDate', 'sessionsTableHtml', 'instituteName'],
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#ffffff">
  <h2 style="color:#1a1a1a">${t('scheduledParentsAttendance.heading')}</h2>
  <p style="color:#444;line-height:1.6">${t('scheduledParentsAttendance.greeting')}</p>
  <p style="color:#444;line-height:1.6">${tt('scheduledParentsAttendance.intro', ['fullName', 'startDate', 'endDate'])}</p>
  <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:24px;text-align:center;margin:20px 0">
    <div style="font-size:44px;font-weight:bold;color:#16a34a;line-height:1.2">${tt('scheduledParentsAttendance.percentValue', ['attendancePercentage'])}%</div>
    <div style="color:#444;margin-top:12px;font-size:14px">${t('scheduledParentsAttendance.attendanceRateLabel')}</div>
    <div style="color:#666;margin-top:6px;font-size:13px">${tt('scheduledParentsAttendance.sessionsSummary', ['sessionsAttended', 'totalSessions'])}</div>
  </div>
  <h3 style="color:#1e293b;margin-top:24px">${t('scheduledParentsAttendance.sessionDetailsHeading')}</h3>
  {{sessionsTableHtml}}
  <p style="color:#444;line-height:1.6;margin-top:16px">${t('scheduledParentsAttendance.body1')}</p>
  <p style="color:#888;font-size:13px;margin-top:32px">${footer()}</p>
</div>`,
  },

  // ─── Membership ───

  membership_expiry_reminder: {
    name: 'Membership Expiry Reminder',
    subject: tt('membershipExpiryReminder.subject', ['fullName']),
    variables: ['fullName', 'email', 'instituteName'],
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#ffffff">
  <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin-bottom:24px;text-align:center">
    <h2 style="color:#dc2626;margin:0">${t('membershipExpiryReminder.bannerTitle')}</h2>
  </div>
  <p style="color:#444;line-height:1.6">${t('membershipExpiryReminder.greetingLabel')} <strong>${tt('membershipExpiryReminder.greetingName', ['fullName'])}</strong>,</p>
  <p style="color:#444;line-height:1.6">${t('membershipExpiryReminder.body1')}</p>
  <div style="text-align:center;margin:32px 0">
    <a style="background:#2563eb;color:#ffffff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">${t('membershipExpiryReminder.cta')}</a>
  </div>
  <p style="color:#888;font-size:13px">${t('membershipExpiryReminder.footNote')}</p>
  <p style="color:#888;font-size:13px;margin-top:32px">${footer()}</p>
</div>`,
  },

  scheduled_expiry_check: {
    name: 'Membership Renewal Reminder',
    subject: tt('scheduledExpiryCheck.subject', ['fullName']),
    variables: ['fullName', 'email', 'instituteName'],
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#ffffff">
  <h2 style="color:#1a1a1a">${tt('scheduledExpiryCheck.greeting', ['fullName'])}</h2>
  <p style="color:#444;line-height:1.6">${t('scheduledExpiryCheck.body1')}</p>
  <p style="color:#444;line-height:1.6">${t('scheduledExpiryCheck.body2')}</p>
  <p style="color:#888;font-size:13px;margin-top:32px">${footer()}</p>
</div>`,
  },

  // ─── Assessment ───

  assessment_created_notify: {
    name: 'New Assessment Available',
    subject: tt('assessmentCreatedNotify.subject', ['fullName']),
    variables: ['fullName', 'email', 'instituteName'],
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#ffffff">
  <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px;margin-bottom:24px;text-align:center">
    <h2 style="color:#2563eb;margin:0">${t('assessmentCreatedNotify.bannerTitle')}</h2>
  </div>
  <p style="color:#444;line-height:1.6">${t('assessmentCreatedNotify.greetingLabel')} <strong>${tt('assessmentCreatedNotify.greetingName', ['fullName'])}</strong>,</p>
  <p style="color:#444;line-height:1.6">${t('assessmentCreatedNotify.body1')}</p>
  <p style="color:#444;line-height:1.6">${t('assessmentCreatedNotify.goodLuck')}</p>
  <p style="color:#888;font-size:13px;margin-top:32px">${footer()}</p>
</div>`,
  },

  assessment_email_batch: {
    name: 'Assessment Completion',
    subject: tt('assessmentEmailBatch.subject', ['fullName']),
    variables: ['fullName', 'email', 'instituteName'],
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#ffffff">
  <div style="text-align:center;padding:24px 0">
    <h1 style="color:#16a34a;margin:0">${t('assessmentEmailBatch.heroTitle')}</h1>
  </div>
  <p style="color:#444;line-height:1.6">${t('assessmentEmailBatch.greetingLabel')} <strong>${tt('assessmentEmailBatch.greetingName', ['fullName'])}</strong>,</p>
  <p style="color:#444;line-height:1.6">${t('assessmentEmailBatch.body1')}</p>
  <p style="color:#888;font-size:13px;margin-top:32px">${footer()}</p>
</div>`,
  },

  // ─── Invites ───

  invite_notify_batch: {
    name: 'New Enrollment Invite',
    subject: t('inviteNotifyBatch.subject'),
    variables: ['fullName', 'email', 'instituteName'],
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#ffffff">
  <h2 style="color:#1a1a1a">${tt('inviteNotifyBatch.greeting', ['fullName'])}</h2>
  <p style="color:#444;line-height:1.6">${t('inviteNotifyBatch.body1')}</p>
  <p style="color:#888;font-size:13px;margin-top:32px">${footer()}</p>
</div>`,
  },

  // ─── Scheduled audience ───

  scheduled_audience_followup: {
    name: 'Audience Follow-up',
    subject: tt('scheduledAudienceFollowup.subject', ['parentName']),
    variables: ['parentName', 'email', 'instituteName'],
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#ffffff">
  <h2 style="color:#1a1a1a">${tt('scheduledAudienceFollowup.greeting', ['parentName'])}</h2>
  <p style="color:#444;line-height:1.6">${t('scheduledAudienceFollowup.body1')}</p>
  <p style="color:#444;line-height:1.6">${t('scheduledAudienceFollowup.body2')}</p>
  <p style="color:#888;font-size:13px;margin-top:32px">${footer()}</p>
</div>`,
  },

  // ─── Live class ended (post-class recap) ───
  // Keyed by sampleTemplateKey on the LIVE_SESSION_END use-case questions, not
  // by useCaseId — that use-case has TWO template_select questions and needs
  // distinct samples per question (present vs absent).

  live_session_recap_present: {
    name: 'Live Class Recap (Attended)',
    subject: tt('liveSessionRecapPresent.subject', ['sessionTitle']),
    // The {{attendanceBlockHtml}} placeholder is a pre-rendered HTML snippet from
    // the backend — full styled attendance box when join-time data is available,
    // EMPTY STRING when the provider hasn't synced yet (no misleading "0%" line).
    // The raw fields (joinTime, attendedMinutes, attendancePercentage,
    // sessionDurationMinutes) are still emitted on every row for users who want to
    // build their own custom layout instead of the default block.
    variables: [
      'fullName',
      'sessionTitle',
      'date',
      'time',
      'attendanceBlockHtml',
      'joinTime',
      'attendedMinutes',
      'attendancePercentage',
      'sessionDurationMinutes',
      'instituteName',
    ],
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#ffffff">
  <div style="text-align:center;padding:16px 0">
    <h1 style="color:#16a34a;margin:0;font-size:22px">${t('liveSessionRecapPresent.heroTitle')}</h1>
  </div>
  <h2 style="color:#1a1a1a">${tt('liveSessionRecapPresent.greeting', ['fullName'])}</h2>
  <p style="color:#444;line-height:1.6">${tt('liveSessionRecapPresent.body1', ['sessionTitle', 'date', 'time'])}</p>

  {{attendanceBlockHtml}}

  <p style="color:#444;line-height:1.6">${t('liveSessionRecapPresent.body2')}</p>
  <p style="color:#888;font-size:13px;margin-top:32px">${footer()}</p>
</div>`,
  },

  live_session_recap_absent: {
    name: 'Live Class Recap (Missed)',
    subject: tt('liveSessionRecapAbsent.subject', ['sessionTitle']),
    variables: ['fullName', 'sessionTitle', 'date', 'time', 'instituteName'],
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#ffffff">
  <div style="text-align:center;padding:16px 0">
    <h1 style="color:#d97706;margin:0;font-size:22px">${t('liveSessionRecapAbsent.heroTitle')}</h1>
  </div>
  <h2 style="color:#1a1a1a">${tt('liveSessionRecapAbsent.greeting', ['fullName'])}</h2>
  <p style="color:#444;line-height:1.6">${tt('liveSessionRecapAbsent.body1', ['sessionTitle', 'date', 'time'])}</p>
  <p style="color:#444;line-height:1.6">${t('liveSessionRecapAbsent.body2')}</p>
  <p style="color:#888;font-size:13px;margin-top:32px">${footer()}</p>
</div>`,
  },

  // ─── Lead trigger events (TAT + counsellor-scheduled follow-ups + status / assignment) ───
  // Keyed by the WorkflowTriggerEvent name so any email-template UI can offer them by event.
  // Variables come from LeadTriggerContextBuilder + LeadAutomationScheduler emit ctx.

  LEAD_ASSIGNED_TO_COUNSELOR: {
    name: 'Lead Assigned — Counsellor Notice',
    subject: tt('leadAssignedToCounselor.subject', ['leadName']),
    variables: [
      'counselorName',
      'leadName',
      'leadMobile',
      'leadEmail',
      'campaignName',
      'tat',
    ],
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="color:#1a1a1a">${tt('leadAssignedToCounselor.greeting', ['counselorName'])}</h2>
  <p style="color:#444;line-height:1.6">${t('leadAssignedToCounselor.body1')}</p>
  <ul style="color:#444;line-height:1.8">
    <li><strong>${t('leadAssignedToCounselor.nameLabel')}</strong> ${tt('leadAssignedToCounselor.nameValue', ['leadName'])}</li>
    <li><strong>${t('leadAssignedToCounselor.mobileLabel')}</strong> ${tt('leadAssignedToCounselor.mobileValue', ['leadMobile'])}</li>
    <li><strong>${t('leadAssignedToCounselor.emailLabel')}</strong> ${tt('leadAssignedToCounselor.emailValue', ['leadEmail'])}</li>
    <li><strong>${t('leadAssignedToCounselor.campaignLabel')}</strong> ${tt('leadAssignedToCounselor.campaignValue', ['campaignName'])}</li>
  </ul>
  <p style="color:#444;line-height:1.6">${tt('leadAssignedToCounselor.body2', ['tat'])}</p>
</div>`,
  },

  LEAD_TAT_REMINDER_BEFORE: {
    name: 'Lead TAT — Reminder',
    subject: tt('leadTatReminderBefore.subject', ['leadName', 'minutesToBreach']),
    variables: [
      'counselorName',
      'leadName',
      'leadMobile',
      'campaignName',
      'minutesToBreach',
      'dueAt',
    ],
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="color:#b45309">${t('leadTatReminderBefore.heading')}</h2>
  <p style="color:#444;line-height:1.6">${tt('leadTatReminderBefore.greeting', ['counselorName'])}</p>
  <p style="color:#444;line-height:1.6">${tt('leadTatReminderBefore.body1', ['minutesToBreach'])}</p>
  <ul style="color:#444;line-height:1.8">
    <li><strong>${tt('leadTatReminderBefore.leadName', ['leadName'])}</strong> — ${tt('leadTatReminderBefore.leadMobile', ['leadMobile'])}</li>
    <li>${tt('leadTatReminderBefore.campaignLine', ['campaignName'])}</li>
    <li>${tt('leadTatReminderBefore.dueAtLine', ['dueAt'])}</li>
  </ul>
</div>`,
  },

  LEAD_TAT_OVERDUE: {
    name: 'Lead TAT — Overdue',
    subject: tt('leadTatOverdue.subject', ['leadName']),
    variables: [
      'counselorName',
      'leadName',
      'leadMobile',
      'campaignName',
      'dueAt',
    ],
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="color:#b91c1c">${t('leadTatOverdue.heading')}</h2>
  <p style="color:#444;line-height:1.6">${tt('leadTatOverdue.body1', ['counselorName'])}</p>
  <ul style="color:#444;line-height:1.8">
    <li><strong>${tt('leadTatOverdue.leadName', ['leadName'])}</strong> — ${tt('leadTatOverdue.leadMobile', ['leadMobile'])}</li>
    <li>${tt('leadTatOverdue.campaignLine', ['campaignName'])}</li>
    <li>${tt('leadTatOverdue.dueAtLine', ['dueAt'])}</li>
  </ul>
  <p style="color:#444">${t('leadTatOverdue.body2')}</p>
</div>`,
  },

  FOLLOW_UP_DUE: {
    name: 'Follow-up — Due',
    subject: tt('followUpDue.subject', ['leadName']),
    variables: [
      'counselorName',
      'leadName',
      'leadMobile',
      'dueAt',
      'minutesToBreach',
    ],
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="color:#1a1a1a">${t('followUpDue.heading')}</h2>
  <p style="color:#444;line-height:1.6">${tt('followUpDue.body1', ['counselorName', 'leadName', 'leadMobile', 'minutesToBreach', 'dueAt'])}</p>
</div>`,
  },

  FOLLOW_UP_OVERDUE: {
    name: 'Follow-up — Overdue',
    subject: tt('followUpOverdue.subject', ['leadName']),
    variables: ['counselorName', 'leadName', 'leadMobile', 'dueAt'],
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="color:#b91c1c">${t('followUpOverdue.heading')}</h2>
  <p style="color:#444;line-height:1.6">${tt('followUpOverdue.body1', ['counselorName', 'leadName', 'leadMobile', 'dueAt'])}</p>
  <p style="color:#444">${t('followUpOverdue.body2')}</p>
</div>`,
  },

  LEAD_STATUS_CHANGED: {
    name: 'Lead Status Changed',
    subject: tt('leadStatusChanged.subject', ['leadName', 'newStatus']),
    variables: [
      'counselorName',
      'leadName',
      'oldStatus',
      'newStatus',
      'changeType',
    ],
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="color:#1a1a1a">${t('leadStatusChanged.heading')}</h2>
  <p style="color:#444;line-height:1.6">${tt('leadStatusChanged.greeting', ['counselorName'])}</p>
  <p style="color:#444;line-height:1.6">${tt('leadStatusChanged.body1', ['leadName', 'oldStatus', 'newStatus', 'changeType'])}</p>
</div>`,
  },
  };
}
