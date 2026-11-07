-- Moodle welcome emails: course-info copy moves from the templates into each
-- course's description (package.course_html_description).
--
-- Why: wf_moodle_enrollment is ONE workflow serving every Vet Education course
-- (scoped by per-package-session workflow_trigger rows), and both its email
-- templates hardcode the on-demand wording for "How this course is structured"
-- plus a "Tips to get the most out of it" section. Deep Dive Live courses need
-- different structure copy and no tips section, so the copy has to come from the
-- course, not the template.
--
-- After this: the two blocks collapse into a single {{courseDescription}} block.
-- A course with a description renders it (OD = both sections, DDL = structure
-- only); a course without one falls back to defaultCourseDescriptionHtml on the
-- fetch node, which carries today's on-demand copy verbatim.
--
-- REQUIRES the matching admin_core_service deploy: fetchPackageLMSSetting only
-- returns courseDescription after that change. Applied before the deploy, every
-- welcome email loses the section entirely.
--
-- Target: Vet Education prod (database-1...ap-southeast-2), institute
-- 0bd9421e-2e74-4cfb-bbee-03bc09845bc6.

BEGIN;

-- 1) Backups (same convention as node_template_backup_20260910_moodle)
CREATE TABLE templates_backup_20261002_moodle AS
SELECT * FROM templates WHERE id IN ('516ee717-a81f-457d-a74b-df2f40d659a4',
                                     '47435d95-e58e-4c1d-b28a-8035217290b0');

CREATE TABLE node_template_backup_20261002_moodle AS
SELECT * FROM node_template WHERE id IN ('nt_moodle_fetch_config',
                                         'nt_moodle_email_credentials',
                                         'nt_moodle_email_reset');

-- 2) Email templates: two hardcoded blocks -> one {{courseDescription}} block
UPDATE templates SET content = '<!doctype html>
<html lang="und" dir="auto" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
  <head>
    <title></title>
    <!--[if !mso]><!-->
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <!--<![endif]-->
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style type="text/css">
      #outlook a { padding:0; }
      body { margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%; }
      table, td { border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt; }
      img { border:0;height:auto;line-height:100%; outline:none;text-decoration:none;-ms-interpolation-mode:bicubic; }
      p { display:block;margin:13px 0; }
      .course-desc h1, .course-desc h2, .course-desc h3, .course-desc h4 { font-family:Arial, Helvetica, sans-serif;font-size:18px;font-weight:bold;color:#1a1a1a;margin:0 0 6px;line-height:1.3; }
      .course-desc p { margin:13px 0; }
      .course-desc ul, .course-desc ol { margin:13px 0;padding-left:22px; }
      .course-desc li { margin:4px 0; }
      .course-desc img { max-width:100%;height:auto; }
    </style>
    <!--[if mso]>
    <noscript>
    <xml>
    <o:OfficeDocumentSettings>
      <o:AllowPNG/>
      <o:PixelsPerInch>96</o:PixelsPerInch>
    </o:OfficeDocumentSettings>
    </xml>
    </noscript>
    <![endif]-->
    <!--[if lte mso 11]>
    <style type="text/css">
      .mj-outlook-group-fix { width:100% !important; }
    </style>
    <![endif]-->
    
      <!--[if !mso]><!-->
        <link href="https://fonts.googleapis.com/css?family=Droid+Sans:300,400,500,700" rel="stylesheet" type="text/css">
<link href="https://fonts.googleapis.com/css?family=Roboto:300,400,500,700" rel="stylesheet" type="text/css">
<link href="https://fonts.googleapis.com/css?family=Ubuntu:300,400,500,700" rel="stylesheet" type="text/css">
        <style type="text/css">
          @import url(https://fonts.googleapis.com/css?family=Droid+Sans:300,400,500,700);
@import url(https://fonts.googleapis.com/css?family=Roboto:300,400,500,700);
@import url(https://fonts.googleapis.com/css?family=Ubuntu:300,400,500,700);
        </style>
      <!--<![endif]-->

    
    
    <style type="text/css">
      @media only screen and (min-width:480px) {
        .mj-column-per-100 { width:100% !important; max-width: 100%; }
      }
    </style>
    <style media="screen and (min-width:480px)">
      .moz-text-html .mj-column-per-100 { width:100% !important; max-width: 100%; }
    </style>
    
    
  
    
    
    
  </head>
  
      <body  style="word-spacing:normal;background-color:#f4f5f7;">
        
        <div
           aria-roledescription="email" role="article" lang="und" dir="auto" style="word-spacing:normal;background-color:#f4f5f7;"
        >
        
      
      <!--[if mso | IE]><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#ffffff" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#ffffff;background-color:#ffffff;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;background-color:#ffffff;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="border:none;direction:ltr;font-size:0px;padding:24px 0px 6px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:600px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%"
      >
        <tbody>
          <tr>
            <td  style="border:none;vertical-align:top;padding:0px;">
              
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="left" style="font-size:0px;padding:6px 24px;word-break:break-word;"
                >
                  
      <div
         style="font-family:Arial, Helvetica, sans-serif;font-size:15px;font-weight:400;line-height:1.6;text-align:left;color:#3b3f44;"
      ><p>Hi {{firstName}},</p><p>Thank you for joining us for <strong>{{courseName}}</strong> with Vet Education - we’re really happy to have you on board.</p><p>Here are your login details to get started:</p></div>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
            </td>
          </tr>
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#ffffff" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#ffffff;background-color:#ffffff;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;background-color:#ffffff;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="border:none;direction:ltr;font-size:0px;padding:0px 0px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:600px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%"
      >
        <tbody>
          <tr>
            <td  style="border:none;vertical-align:top;padding:0px;">
              
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="left" style="font-size:0px;padding:6px 24px;word-break:break-word;"
                >
                  
      <div
         style="font-family:Arial, Helvetica, sans-serif;font-size:15px;font-weight:400;line-height:1.6;text-align:left;color:#3b3f44;"
      ><p style="font-size:18px;font-weight:bold;color:#1a1a1a;margin:0 0 6px;">Your course login</p><p>Head to your course area:</p></div>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
            </td>
          </tr>
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#ffffff" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#ffffff;background-color:#ffffff;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;background-color:#ffffff;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="border:none;direction:ltr;font-size:0px;padding:0px 0px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:600px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%"
      >
        <tbody>
          <tr>
            <td  style="border:none;vertical-align:top;padding:0px;">
              
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="left" style="font-size:0px;padding:6px 24px;word-break:break-word;"
                >
                  
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:separate;line-height:100%;"
      >
        <tbody>
          <tr>
            <td
               align="center" bgcolor="#0092ff" role="presentation" style="border:none;border-radius:6px;cursor:auto;mso-padding-alt:12px 28px;text-align:center;background:#0092ff;" valign="middle"
            >
              <a
                 href="https://veteducationcourses.com.au/" style="display:inline-block;background:#0092ff;color:#ffffff;font-family:-apple-system, BlinkMacSystemFont, ''Segoe UI'', ''Roboto'', ''Oxygen'', ''Ubuntu'', ''Cantarell'', ''Fira Sans'', ''Droid Sans'',''Helvetica Neue'', sans-serif;font-size:15px;font-weight:bold;line-height:120%;margin:0;text-decoration:none;text-transform:none;padding:12px 28px;mso-padding-alt:0px;border-radius:6px;" target="_blank"
              >
                Log in to your course
              </a>
            </td>
          </tr>
        </tbody>
      </table>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
            </td>
          </tr>
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#ffffff" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#ffffff;background-color:#ffffff;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;background-color:#ffffff;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="border:none;direction:ltr;font-size:0px;padding:0px 0px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:600px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%"
      >
        <tbody>
          <tr>
            <td  style="border:none;vertical-align:top;padding:0px;">
              
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="left" style="font-size:0px;padding:6px 24px;word-break:break-word;"
                >
                  
      <div
         style="font-family:Arial, Helvetica, sans-serif;font-size:15px;font-weight:400;line-height:1.6;text-align:left;color:#3b3f44;"
      ><p style="margin:6px 0;"><strong>Username:</strong> {{username}}</p><p style="margin:6px 0;"><strong>Password:</strong> {{password}}</p><p>👉 Once you’ve logged in, we recommend updating your password via <em>My Account / Profile</em> for security. You should see your course under the <em>My Courses</em> area.</p></div>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
            </td>
          </tr>
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#ffffff" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#ffffff;background-color:#ffffff;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;background-color:#ffffff;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="border:none;direction:ltr;font-size:0px;padding:0px 0px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:600px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%"
      >
        <tbody>
          <tr>
            <td  style="border:none;vertical-align:top;padding:0px;">
              
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="left" style="font-size:0px;padding:6px 24px;word-break:break-word;"
                >
                  
      <div
         style="font-family:Arial, Helvetica, sans-serif;font-size:15px;font-weight:400;line-height:1.6;text-align:left;color:#3b3f44;"
      ><div class="course-desc">{{courseDescription}}</div></div>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
            </td>
          </tr>
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#ffffff" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#ffffff;background-color:#ffffff;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;background-color:#ffffff;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="border:none;direction:ltr;font-size:0px;padding:0px 0px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:600px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%"
      >
        <tbody>
          <tr>
            <td  style="border:none;vertical-align:top;padding:0px;">
              
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="left" style="font-size:0px;padding:6px 24px;word-break:break-word;"
                >
                  
      <div
         style="font-family:Arial, Helvetica, sans-serif;font-size:15px;font-weight:400;line-height:1.6;text-align:left;color:#3b3f44;"
      ><p style="font-size:18px;font-weight:bold;color:#1a1a1a;margin:0 0 6px;">🆘 Need help? We’re here.</p><p>If you get stuck with content, quizzes, or tech/logins, or you’re just not sure where to click next - please reach out.</p><p>You can contact us at:<br/><strong>Email:</strong> <a href="mailto:info@veteducation.com.au">info@veteducation.com.au</a></p><p>We genuinely love supporting our veterinary community, so please don’t hesitate to ask.</p></div>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
            </td>
          </tr>
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#ffffff" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#ffffff;background-color:#ffffff;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;background-color:#ffffff;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="border:none;direction:ltr;font-size:0px;padding:6px 0px 28px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:600px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%"
      >
        <tbody>
          <tr>
            <td  style="border:none;vertical-align:top;padding:0px;">
              
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="left" style="font-size:0px;padding:6px 24px;word-break:break-word;"
                >
                  
      <div
         style="font-family:Arial, Helvetica, sans-serif;font-size:15px;font-weight:400;line-height:1.6;text-align:left;color:#3b3f44;"
      ><p>Welcome again to <strong>{{courseName}}</strong> - we hope you enjoy the course and that it adds something genuinely useful to your day-to-day practice.</p><p style="margin:14px 0 0;">Warm regards,<br/>The Vet Education Team<br/>Vet Education<br/><a href="https://veteducation.com">https://veteducation.com</a></p></div>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
            </td>
          </tr>
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><![endif]-->
    
    
      </div>
      </body>
    
</html>
  ', updated_at = now()
 WHERE id = '516ee717-a81f-457d-a74b-df2f40d659a4'
 RETURNING id, name, length(content);
UPDATE templates SET content = '<!doctype html>
<html lang="und" dir="auto" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
  <head>
    <title></title>
    <!--[if !mso]><!-->
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <!--<![endif]-->
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style type="text/css">
      #outlook a { padding:0; }
      body { margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%; }
      table, td { border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt; }
      img { border:0;height:auto;line-height:100%; outline:none;text-decoration:none;-ms-interpolation-mode:bicubic; }
      p { display:block;margin:13px 0; }
      .course-desc h1, .course-desc h2, .course-desc h3, .course-desc h4 { font-family:Arial, Helvetica, sans-serif;font-size:18px;font-weight:bold;color:#1a1a1a;margin:0 0 6px;line-height:1.3; }
      .course-desc p { margin:13px 0; }
      .course-desc ul, .course-desc ol { margin:13px 0;padding-left:22px; }
      .course-desc li { margin:4px 0; }
      .course-desc img { max-width:100%;height:auto; }
    </style>
    <!--[if mso]>
    <noscript>
    <xml>
    <o:OfficeDocumentSettings>
      <o:AllowPNG/>
      <o:PixelsPerInch>96</o:PixelsPerInch>
    </o:OfficeDocumentSettings>
    </xml>
    </noscript>
    <![endif]-->
    <!--[if lte mso 11]>
    <style type="text/css">
      .mj-outlook-group-fix { width:100% !important; }
    </style>
    <![endif]-->
    
      <!--[if !mso]><!-->
        <link href="https://fonts.googleapis.com/css?family=Droid+Sans:300,400,500,700" rel="stylesheet" type="text/css">
<link href="https://fonts.googleapis.com/css?family=Roboto:300,400,500,700" rel="stylesheet" type="text/css">
<link href="https://fonts.googleapis.com/css?family=Ubuntu:300,400,500,700" rel="stylesheet" type="text/css">
        <style type="text/css">
          @import url(https://fonts.googleapis.com/css?family=Droid+Sans:300,400,500,700);
@import url(https://fonts.googleapis.com/css?family=Roboto:300,400,500,700);
@import url(https://fonts.googleapis.com/css?family=Ubuntu:300,400,500,700);
        </style>
      <!--<![endif]-->

    
    
    <style type="text/css">
      @media only screen and (min-width:480px) {
        .mj-column-per-100 { width:100% !important; max-width: 100%; }
      }
    </style>
    <style media="screen and (min-width:480px)">
      .moz-text-html .mj-column-per-100 { width:100% !important; max-width: 100%; }
    </style>
    
    
  
    
    
    
  </head>
  <body style="word-spacing:normal;background-color:#f4f5f7;">
    
    
      <div
         aria-roledescription="email" style="background-color:#f4f5f7;" role="article" lang="und" dir="auto"
      >
        
      
      <!--[if mso | IE]><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#ffffff" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#ffffff;background-color:#ffffff;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;background-color:#ffffff;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="border:none;direction:ltr;font-size:0px;padding:24px 0px 6px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:600px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%"
      >
        <tbody>
          <tr>
            <td  style="border:none;vertical-align:top;padding:0px;">
              
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="left" style="font-size:0px;padding:6px 24px;word-break:break-word;"
                >
                  
      <div
         style="font-family:Arial, Helvetica, sans-serif;font-size:15px;font-weight:400;line-height:1.6;text-align:left;color:#3b3f44;"
      ><p>Hi {{firstName}},</p><p>Thank you for joining us for <strong>{{courseName}}</strong> with Vet Education - we’re really happy to have you on board.</p></div>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
            </td>
          </tr>
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#ffffff" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#ffffff;background-color:#ffffff;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;background-color:#ffffff;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="border:none;direction:ltr;font-size:0px;padding:0px 0px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:600px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%"
      >
        <tbody>
          <tr>
            <td  style="border:none;vertical-align:top;padding:0px;">
              
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="left" style="font-size:0px;padding:6px 24px  ;word-break:break-word;"
                >
                  
      <div
         style="font-family:Arial, Helvetica, sans-serif;font-size:15px;font-weight:400;line-height:1.6;text-align:left;color:#3b3f44;"
      ><p style="font-size:18px;font-weight:bold;color:#1a1a1a;margin:0 0 6px;">Your course access</p><p>You can find your course area here:<br/><a href="https://veteducationcourses.com.au/">https://veteducationcourses.com.au/</a></p><p>We see you’ve taken a Vet Education course with us before. Log in with your existing username and password, or reset it here if needed:</p></div>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
            </td>
          </tr>
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#ffffff" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#ffffff;background-color:#ffffff;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;background-color:#ffffff;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="border:none;direction:ltr;font-size:0px;padding:0px 0px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:600px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%"
      >
        <tbody>
          <tr>
            <td  style="border:none;vertical-align:top;padding:0px;">
              
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="left" style="font-size:0px;padding:6px 24px  ;word-break:break-word;"
                >
                  
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:separate;line-height:100%;"
      >
        <tbody>
          <tr>
            <td
               align="center" bgcolor="#0092ff" role="presentation" style="border:none;border-radius:6px;cursor:auto;mso-padding-alt:12px 28px  ;text-align:center;background:#0092ff;" valign="middle"
            >
              <a
                 href="https://veteducationcourses.com.au/" style="display:inline-block;background:#0092ff;color:#ffffff;font-family:-apple-system, BlinkMacSystemFont, ''Segoe UI'', ''Roboto'', ''Oxygen'', ''Ubuntu'', ''Cantarell'', ''Fira Sans'', ''Droid Sans'',''Helvetica Neue'', sans-serif;font-size:15px;font-weight:bold;line-height:120%;margin:0;text-decoration:none;text-transform:none;padding:12px 28px  ;mso-padding-alt:0px;border-radius:6px;" target="_blank"
              >
                Reset Password
              </a>
            </td>
          </tr>
        </tbody>
      </table>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
            </td>
          </tr>
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#ffffff" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#ffffff;background-color:#ffffff;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;background-color:#ffffff;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="border:none;direction:ltr;font-size:0px;padding:0px 0px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:600px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%"
      >
        <tbody>
          <tr>
            <td  style="border:none;vertical-align:top;padding:0px;">
              
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="left" style="font-size:0px;padding:6px 24px;word-break:break-word;"
                >
                  
      <div
         style="font-family:Arial, Helvetica, sans-serif;font-size:15px;font-weight:400;line-height:1.6;text-align:left;color:#3b3f44;"
      ><div class="course-desc">{{courseDescription}}</div></div>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
            </td>
          </tr>
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#ffffff" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#ffffff;background-color:#ffffff;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;background-color:#ffffff;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="border:none;direction:ltr;font-size:0px;padding:0px 0px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:600px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%"
      >
        <tbody>
          <tr>
            <td  style="border:none;vertical-align:top;padding:0px;">
              
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="left" style="font-size:0px;padding:6px 24px;word-break:break-word;"
                >
                  
      <div
         style="font-family:Arial, Helvetica, sans-serif;font-size:15px;font-weight:400;line-height:1.6;text-align:left;color:#3b3f44;"
      ><p style="font-size:18px;font-weight:bold;color:#1a1a1a;margin:0 0 6px;">🆘 Need help? We’re here.</p><p>If you get stuck with content, quizzes, or tech/logins, or you’re just not sure where to click next - please reach out.</p><p>You can contact us at:<br/><strong>Email:</strong> <a href="mailto:info@veteducation.com.au">info@veteducation.com.au</a></p><p>We genuinely love supporting our veterinary community, so please don’t hesitate to ask.</p></div>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
            </td>
          </tr>
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#ffffff" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#ffffff;background-color:#ffffff;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;background-color:#ffffff;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="border:none;direction:ltr;font-size:0px;padding:6px 0px 28px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:600px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%"
      >
        <tbody>
          <tr>
            <td  style="border:none;vertical-align:top;padding:0px;">
              
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="left" style="font-size:0px;padding:6px 24px;word-break:break-word;"
                >
                  
      <div
         style="font-family:Arial, Helvetica, sans-serif;font-size:15px;font-weight:400;line-height:1.6;text-align:left;color:#3b3f44;"
      ><p>Welcome again to <strong>{{courseName}}</strong> - we hope you enjoy the course and that it adds something genuinely useful to your day-to-day practice.</p><p style="margin:14px 0 0;">Warm regards,<br/>The Vet Education Team<br/>Vet Education<br/><a href="https://veteducation.com">https://veteducation.com</a></p></div>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
            </td>
          </tr>
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><![endif]-->
    
    
      </div>
    
  </body>
</html>
  ', updated_at = now()
 WHERE id = '47435d95-e58e-4c1d-b28a-8035217290b0'
 RETURNING id, name, length(content);

-- 3) Workflow nodes: supply the OD fallback, and pass the value to both templates
UPDATE node_template SET config_json = '{
  "params": {
    "packageId": "#ctx[\"packageId\"]",
    "settingKey": "MOODLE_SETTING",
    "defaultCourseDescriptionHtml": "<p style=\"font-size:18px;font-weight:bold;color:#1a1a1a;margin:0 0 6px;\">How this course is structured</p><p>When you open the course, you’ll see it divided into clearly marked sections - each shown as a separate image block or module.</p><p>Every section includes:</p><ul><li>A lecture</li><li>Downloadable notes</li><li>A short quiz to help consolidate your learning</li></ul><p>Work through the sections at your own pace. Once you’ve completed all sections and quizzes, you’ll be able to download your certificate for the full on-demand course.</p><p style=\"font-size:18px;font-weight:bold;color:#1a1a1a;margin:18px 0 6px;\">💡 Tips to get the most out of it</p><ul><li>You can pause, rewind and rewatch lectures as often as you like.</li><li>You don’t have to finish everything in one sitting.</li><li>You have access to this course for 3 months. However, we understand that life and work have a way of getting overwhelming sometimes. So if you cannot complete this course within 3 months, email us and we can extend the course access for you.</li></ul>"
  },
  "routing": [
    {
      "type": "goto",
      "targetNodeId": "nt_moodle_lookup_user"
    }
  ],
  "prebuiltKey": "fetchPackageLMSSetting"
}', updated_at = now()
 WHERE id = 'nt_moodle_fetch_config'
 RETURNING id, node_name;
UPDATE node_template SET config_json = '{
  "on": "(#ctx[''moodleSearchResponse''] != null and #ctx[''moodleSearchResponse''][''body''] != null and #ctx[''moodleSearchResponse''][''body''].size() > 0) ? {} : ((#ctx[''moodleCreateResponse''] != null and #ctx[''moodleCreateResponse''][''body''] != null and #ctx[''moodleCreateResponse''][''body''].size() > 0 and !(#ctx[''moodleCreateResponse''][''body''].toString().contains(''exception''))) ? {#ctx[''user'']} : {})",
  "recipientField": "email",
  "templateName": "Moodle New User Credentials",
  "templateVars": {
    "firstName": "#ctx[''user''].fullName != null ? #ctx[''user''].fullName.split('' '')[0] : ''''",
    "fullName": "#ctx[''user''].fullName",
    "username": "#ctx[''user''].username",
    "password": "#ctx[''user''].password",
    "email": "#ctx[''user''].email",
    "courseName": "#ctx[''packageName'']",
    "instituteName": "#ctx[''instituteName'']",
    "courseDescription": "#ctx[''courseDescription'']"
  },
  "forEach": {
    "operation": "SEND_EMAIL",
    "eval": "#ctx[''item'']"
  },
  "routing": [
    {
      "type": "goto",
      "targetNodeId": "nt_moodle_email_reset"
    }
  ]
}', updated_at = now()
 WHERE id = 'nt_moodle_email_credentials'
 RETURNING id, node_name;
UPDATE node_template SET config_json = '{
  "on": "(#ctx[''moodleSearchResponse''] != null and #ctx[''moodleSearchResponse''][''body''] != null and #ctx[''moodleSearchResponse''][''body''].size() > 0) ? {#ctx[''user'']} : {}",
  "recipientField": "email",
  "templateName": "Moodle Existing User Reset Link",
  "templateVars": {
    "firstName": "#ctx[''user''].fullName != null ? #ctx[''user''].fullName.split('' '')[0] : ''''",
    "fullName": "#ctx[''user''].fullName",
    "email": "#ctx[''user''].email",
    "courseName": "#ctx[''packageName'']",
    "instituteName": "#ctx[''instituteName'']",
    "resetLink": "https://veteducationcourses.com.au/login/forgot_password.php",
    "courseDescription": "#ctx[''courseDescription'']"
  },
  "forEach": {
    "operation": "SEND_EMAIL",
    "eval": "#ctx[''item'']"
  },
  "routing": [
    {
      "type": "end"
    }
  ]
}', updated_at = now()
 WHERE id = 'nt_moodle_email_reset'
 RETURNING id, node_name;

-- Verify before committing: each template must hold exactly one placeholder and
-- neither of the old headings.
SELECT id, name,
       (content LIKE '%{{courseDescription}}%')          AS has_placeholder,
       (content ILIKE '%How this course is structured%')  AS still_hardcoded_structure,
       (content ILIKE '%Tips to get the most%')           AS still_hardcoded_tips
FROM templates
WHERE id IN ('516ee717-a81f-457d-a74b-df2f40d659a4','47435d95-e58e-4c1d-b28a-8035217290b0');

-- COMMIT;   -- uncomment once the three RETURNING blocks and the check above look right
ROLLBACK;
