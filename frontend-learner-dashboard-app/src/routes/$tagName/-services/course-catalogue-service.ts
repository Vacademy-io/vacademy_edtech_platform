import axios from "axios";
import { BASE_URL } from "@/constants/urls";
import { CourseCatalogueData } from "../-types/course-catalogue-types";
import { getTerminologyPlural } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";

// Create a public axios instance that doesn't require authentication
const publicAxios = axios.create({
  withCredentials: false,
});

export class CourseCatalogueService {
  private static readonly API_ENDPOINT = `${BASE_URL}/admin-core-service/public/course-catalogue/v1/institute/get/by-tag`;

  /**
   * Attempts to repair malformed JSON by fixing common issues
   */
  private static repairJson(jsonString: string): string {
    let repaired = jsonString;
    
    try {
      // First, try to parse as-is
      JSON.parse(repaired);
      return repaired;
    } catch (error) {
      // JSON needs repair, attempting fixes...
    }
    
    // Remove BOM and extra whitespace
    repaired = repaired.replace(/^\uFEFF/, '').trim();
    
    // Process line by line to remove comments more effectively
    const lines = repaired.split('\n');
    const cleanedLines = lines.map((line, index) => {
      const originalLine = line;
      // Remove // comments from each line, but be careful not to remove // that are inside strings
      let cleanedLine = line;
      
      // Only remove // comments that are not inside strings
      let inString = false;
      let inEscape = false;
      let result = '';
      
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = line[i + 1];
        
        if (inEscape) {
          result += char;
          inEscape = false;
        } else if (char === '\\') {
          result += char;
          inEscape = true;
        } else if (char === '"' && !inEscape) {
          inString = !inString;
          result += char;
        } else if (!inString && char === '/' && nextChar === '/') {
          // Found // comment outside of string, remove everything from here to end of line
          break;
        } else {
          result += char;
        }
      }
      
      cleanedLine = result;

      return cleanedLine;
    });
    repaired = cleanedLines.join('\n');
    
    // Fix unquoted property names (most common issue) - be more aggressive
    repaired = repaired.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":');
    
    // Fix unquoted string values - be more aggressive
    repaired = repaired.replace(/:\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*([,}])/g, ': "$1"$2');
    
    // Remove trailing commas
    repaired = repaired.replace(/,(\s*[}\]])/g, '$1');
    
    // Fix single quotes to double quotes
    repaired = repaired.replace(/'/g, '"');
    
    // Remove /* */ comments
    repaired = repaired.replace(/\/\*[\s\S]*?\*\//g, '');
    
    // Try to fix missing quotes around values that should be strings
    repaired = repaired.replace(/:\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*([,}])/g, ': "$1"$2');
    
    // Additional fixes for common JSON issues
    repaired = repaired
      .replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*([,}])/g, '$1"$2": "$3"$4') // Fix key: value pairs
      .replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:\s*"([^"]*)"\s*([,}])/g, '$1"$2": "$3"$4') // Ensure keys are quoted
      .replace(/,(\s*[}\]])/g, '$1'); // Remove trailing commas again
    
    // Try to parse the repaired JSON to see if it works
    try {
      JSON.parse(repaired);
      return repaired;
    } catch (repairError) {
      console.error("[CourseCatalogueService] Repaired JSON still invalid:", repairError);
    }
    
    return repaired;
  }

  /**
   * More aggressive data extraction that tries to find data even in severely malformed JSON
   */
  private static extractDataAggressively(jsonString: string): CourseCatalogueData | null {
    try {
      
      // Create a basic structure
      const aggressiveData: CourseCatalogueData = {
        globalSettings: {
          courseCatalogeType: {
            enabled: false,
            value: ""
          },
          mode: "light",
          fonts : {
            enabled: false,
            family : "Mulish, sans-serif"
            },
          compactness: "medium",
          audience: "all",
          leadCollection: {
            enabled: false,
            mandatory: false,
            inviteLink: null,
            formStyle : {
              type: "single",
              showProgress: false,
              progressType: "bar",
              transition: "slide"
            },
            fields: []
          },
          enrquiry: {
            enabled: true,
            requirePayment: false
          },
          payment: {
            enabled: true,
            provider: "razorpay",
            fields: []
          }
        },
        pages: []
      };
      
      // Try to find leadCollection data using very flexible patterns
      
      // Check for enabled
      if (jsonString.match(/leadCollection[^}]*enabled[^}]*true/gi)) {
        aggressiveData.globalSettings.leadCollection.enabled = true;
      }
      
      // Check for mandatory
      if (jsonString.match(/leadCollection[^}]*mandatory[^}]*true/gi)) {
        aggressiveData.globalSettings.leadCollection.mandatory = true;
      } else if (jsonString.match(/leadCollection[^}]*mandatory[^}]*false/gi)) {
        aggressiveData.globalSettings.leadCollection.mandatory = false;
      }
      
      // Check for multiStep
      if (jsonString.match(/leadCollection[^}]*type[^}]*multiStep/gi)) {
        aggressiveData.globalSettings.leadCollection.formStyle.type = "multiStep";
      }
      
      // Check for showProgress
      if (jsonString.match(/leadCollection[^}]*showProgress[^}]*true/gi)) {
        aggressiveData.globalSettings.leadCollection.formStyle.showProgress = true;
      }
      
      // Try to extract fields using a very flexible approach
      
      const extractedFields = [];
      
      // Look for name field
      if (jsonString.match(/name[^}]*Full Name/gi)) {
        extractedFields.push({
          name: "name",
          label: "Full Name",
          type: "text" as const,
          required: true,
          step: 1
        });
      }
      
      // Look for email field
      if (jsonString.match(/email[^}]*Email/gi)) {
        extractedFields.push({
          name: "email",
          label: "Email",
          type: "email" as const,
          required: true,
          step: 2
        });
      }
      
      // Look for phone field
      if (jsonString.match(/phone[^}]*Phone/gi)) {
        extractedFields.push({
          name: "phone",
          label: "Phone Number",
          type: "tel" as const,
          required: true,
          step: 3
        });
      }
      
      // Look for Level field
      if (jsonString.match(/Level[^}]*Select Level/gi)) {
        extractedFields.push({
          name: "Level",
          label: "Select Level",
          type: "chips" as const,
          required: true,
          step: 4,
          options: [
            { label: "Beginner", value: "Beginner", levelId: "lvl_101", packageSessionId: "pkg_sess_001" },
            { label: "Intermediate", value: "Intermediate", levelId: "lvl_102", packageSessionId: "pkg_sess_002" },
            { label: "Advanced", value: "Advanced", levelId: "lvl_103", packageSessionId: "pkg_sess_003" },
            { label: "Expert", value: "Expert", levelId: "lvl_104", packageSessionId: "pkg_sess_004" }
          ],
          style: {
            variant: "outlined" as const,
            chipColor: "#ED7626", // design-lint-ignore: default chip color
            allowMultiple: false
          }
        });
      }
      
      if (extractedFields.length > 0) {
        aggressiveData.globalSettings.leadCollection.fields = extractedFields;
        aggressiveData.globalSettings.leadCollection.formStyle.type = "multiStep";
        aggressiveData.globalSettings.leadCollection.formStyle.showProgress = true;
      }
      
      return aggressiveData;
    } catch (error) {
      console.error("[CourseCatalogueService] Error in aggressive extraction:", error);
      return null;
    }
  }

  /**
   * Attempts to extract basic structure from malformed JSON using regex
   */
  private static extractBasicStructure(jsonString: string): CourseCatalogueData | null {
    try {
      
      // Extract basic structure using regex patterns
      const globalSettingsMatch = jsonString.match(/"globalSettings"\s*:\s*\{([^}]+)\}/);
      
      if (!globalSettingsMatch) {
        return null;
      }
      
      // Create a basic structure
      const basicData: CourseCatalogueData = {
          globalSettings: {
            courseCatalogeType: {
              enabled: false,
              value: ""
            },
            mode: "light",
            compactness: "medium",
            audience: "all",
            leadCollection: {
              enabled: false,
              mandatory: false,
              inviteLink: null,
              formStyle: {
                type: "single",
                showProgress: false,
                progressType: "bar",
                transition: "slide"
              },
              fields: []
            },
            enrquiry: {
              enabled: true,
              requirePayment: false
            },
            payment: {
              enabled: true,
              provider: "razorpay",
              fields: []
            }
            
          },
          pages: []
        };
        
      
      // Try to extract leadCollection settings - use more flexible regex
      const leadCollectionMatch = jsonString.match(/"leadCollection"\s*:\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/);
      if (leadCollectionMatch) {
        const leadCollectionStr = leadCollectionMatch[1];
        
        const enabledMatch = leadCollectionStr.match(/"enabled"\s*:\s*(true|false)/);
        const mandatoryMatch = leadCollectionStr.match(/"mandatory"\s*:\s*(true|false)/);
        const formStyleMatch = leadCollectionStr.match(/"formStyle"\s*:\s*\{([^}]+)\}/);
        const fieldsMatch = leadCollectionStr.match(/"fields"\s*:\s*\[([^\]]+)\]/);
        
        if (enabledMatch) {
          basicData.globalSettings.leadCollection.enabled = enabledMatch[1] === 'true';
        }
        if (mandatoryMatch) {
          basicData.globalSettings.leadCollection.mandatory = mandatoryMatch[1] === 'true';
        }
        
        // Try to extract formStyle
        if (formStyleMatch) {
          const formStyleStr = formStyleMatch[1];
          
          const typeMatch = formStyleStr.match(/"type"\s*:\s*"([^"]+)"/);
          const showProgressMatch = formStyleStr.match(/"showProgress"\s*:\s*(true|false)/);
          const progressTypeMatch = formStyleStr.match(/"progressType"\s*:\s*"([^"]+)"/);
          const transitionMatch = formStyleStr.match(/"transition"\s*:\s*"([^"]+)"/);
          
          if (typeMatch) {
            basicData.globalSettings.leadCollection.formStyle.type = typeMatch[1] as 'single' | 'multiStep';
          }
          if (showProgressMatch) {
            basicData.globalSettings.leadCollection.formStyle.showProgress = showProgressMatch[1] === 'true';
          }
          if (progressTypeMatch) {
            basicData.globalSettings.leadCollection.formStyle.progressType = progressTypeMatch[1] as 'bar' | 'dots' | 'steps';
          }
          if (transitionMatch) {
            basicData.globalSettings.leadCollection.formStyle.transition = transitionMatch[1] as 'slide' | 'fade';
          }
        }
        
        // Try to extract fields
        if (fieldsMatch) {
          const fieldsStr = fieldsMatch[1];
          
          // This is a simplified extraction - in a real scenario, you'd need more sophisticated parsing
          const fieldMatches = fieldsStr.match(/\{[^}]+\}/g);
          if (fieldMatches) {
            basicData.globalSettings.leadCollection.fields = fieldMatches.map((fieldStr, index) => {
              const nameMatch = fieldStr.match(/"name"\s*:\s*"([^"]+)"/);
              const labelMatch = fieldStr.match(/"label"\s*:\s*"([^"]+)"/);
              const typeMatch = fieldStr.match(/"type"\s*:\s*"([^"]+)"/);
              const requiredMatch = fieldStr.match(/"required"\s*:\s*(true|false)/);
              const stepMatch = fieldStr.match(/"step"\s*:\s*(\d+)/);
              
              return {
                name: nameMatch ? nameMatch[1] : `field_${index}`,
                label: labelMatch ? labelMatch[1] : `Field ${index + 1}`,
                type: (typeMatch ? typeMatch[1] : 'text') as 'text' | 'email' | 'tel' | 'chips' | 'dropdown',
                required: requiredMatch ? requiredMatch[1] === 'true' : false,
                step: stepMatch ? parseInt(stepMatch[1]) : 1
              };
            });
          }
        }
      }
      
      return basicData;
    } catch (error) {
      console.error("[CourseCatalogueService] Error extracting basic structure:", error);
      return null;
    }
  }

  /**
   * In-flight + short-lived cache in front of getCourseCatalogueByTag.
   *
   * A root-mounted host has to look at the root catalogue's page list before
   * it can tell whether "/about" is one of its pages or a second catalogue's
   * tag — and the page component then fetches the same catalogue to render it.
   * Sharing the promise turns that into one request. The TTL is deliberately
   * short (an editor publishing sees the change on the next navigation) and the
   * cache is per tab, so it never masks a Publish for longer than a reload.
   */
  private static readonly memo = new Map<string, { at: number; promise: Promise<CourseCatalogueData> }>();
  private static readonly MEMO_TTL_MS = 30_000;

  static getCourseCatalogueByTagMemo(
    instituteId: string,
    tagName: string
  ): Promise<CourseCatalogueData> {
    const key = `${instituteId}::${tagName}`;
    const hit = this.memo.get(key);
    if (hit && Date.now() - hit.at < this.MEMO_TTL_MS) return hit.promise;
    const promise = this.getCourseCatalogueByTag(instituteId, tagName);
    this.memo.set(key, { at: Date.now(), promise });
    // A failed fetch must not be served from cache for 30s.
    promise.catch(() => { if (this.memo.get(key)?.promise === promise) this.memo.delete(key); });
    return promise;
  }

  static async getCourseCatalogueByTag(
    instituteId: string,
    tagName: string
  ): Promise<CourseCatalogueData> {
    try {
      
      const response = await publicAxios.get(this.API_ENDPOINT, {
        params: {
          instituteId,
          tagName,
          is_course_published_to_catalaouge: true, // Only fetch published courses
        },
        headers: {
          "Content-Type": "application/json",
        },
      });
      
      // Parse the catalogue_json field if it exists
      if (response.data.catalogue_json) {
        try {
                // Try to parse the JSON directly first
                let parsedData;
                try {
                  parsedData = JSON.parse(response.data.catalogue_json);
                } catch (directParseError) {
                  // Use the repair function to fix common JSON issues
                  const cleanedJson = this.repairJson(response.data.catalogue_json);

                  parsedData = JSON.parse(cleanedJson);
                }
                
                // Force check and fix mandatory value from raw JSON if needed
                const rawJson = response.data.catalogue_json;
                const mandatoryMatch = rawJson.match(/"mandatory"\s*:\s*(true|false)/);
                if (mandatoryMatch) {
                  const correctMandatoryValue = mandatoryMatch[1] === 'true';
                  if (parsedData.globalSettings?.leadCollection?.mandatory !== correctMandatoryValue) {
                    parsedData.globalSettings.leadCollection.mandatory = correctMandatoryValue;
                  }
                }
                
                // Filter courses to only show published ones
                if (parsedData.pages) {
                  parsedData.pages = parsedData.pages.map((page: any) => {
                    if (page.components) {
                      page.components = page.components.map((component: any) => {
                        if (component.type === 'courseCatalog' && component.props && component.props.courses) {
                          // Filter courses to only show published ones
                          component.props.courses = component.props.courses.filter((course: any) =>
                            course.is_course_published_to_catalaouge === true
                          );
                        }
                        return component;
                      });
                    }
                    return page;
                  });
                }

                // Validate the structure
                if (!parsedData.globalSettings) {
                  console.warn("[CourseCatalogueService] Missing globalSettings, using fallback");
                  return this.getEmptyCatalogueData();
                }
                
                // Ensure leadCollection has the new structure
                if (parsedData.globalSettings.leadCollection && !parsedData.globalSettings.leadCollection.formStyle) {
                  console.warn("[CourseCatalogueService] Upgrading leadCollection to new structure");
                  parsedData.globalSettings.leadCollection = {
                    ...parsedData.globalSettings.leadCollection,
                    formStyle: {
                      type: "single",
                      showProgress: false,
                      progressType: "bar",
                      transition: "slide"
                    },
                    fields: Array.isArray(parsedData.globalSettings.leadCollection.fields) 
                      ? parsedData.globalSettings.leadCollection.fields.map((field: any) => 
                          typeof field === 'string' 
                            ? { name: field, label: field.charAt(0).toUpperCase() + field.slice(1), type: "text", required: true, step: 1 }
                            : field
                        )
                      : []
                  };
                }
                
                // Carry the catalogue ROW id through. The parsed
                // catalogue_json has no id of its own, and without this an
                // institute running several sites (different tags) cannot tell
                // their traffic apart in analytics.
                parsedData.catalogueId = response.data.id;
                return parsedData;
        } catch (parseError) {
          console.error("[CourseCatalogueService] Error parsing catalogue_json:", parseError);
                console.error("[CourseCatalogueService] Raw JSON that failed to parse:", response.data.catalogue_json);
                console.error("[CourseCatalogueService] Parse error details:", {
                  message: parseError instanceof Error ? parseError.message : 'Unknown parse error',
                  stack: parseError instanceof Error ? parseError.stack : undefined
                });
                
                // Try to return a fallback with the raw data structure
                
                // Try to extract basic structure from the malformed JSON
                try {
                  const fallbackData = this.extractBasicStructure(response.data.catalogue_json);
                  if (fallbackData) {
                    // Force fix mandatory value from raw JSON
                    const rawJson = response.data.catalogue_json;
                    const mandatoryMatch = rawJson.match(/"mandatory"\s*:\s*(true|false)/);
                    if (mandatoryMatch) {
                      const correctMandatoryValue = mandatoryMatch[1] === 'true';
                      fallbackData.globalSettings.leadCollection.mandatory = correctMandatoryValue;
                    }

                    return fallbackData;
                  }
                } catch (extractError) {
                  console.error("[CourseCatalogueService] Failed to extract basic structure:", extractError);
                }
                
                // Try a more aggressive extraction approach
                try {
                  const aggressiveData = this.extractDataAggressively(response.data.catalogue_json);
                  if (aggressiveData) {
                    // Force fix mandatory value from raw JSON
                    const rawJson = response.data.catalogue_json;
                    const mandatoryMatch = rawJson.match(/"mandatory"\s*:\s*(true|false)/);
                    if (mandatoryMatch) {
                      const correctMandatoryValue = mandatoryMatch[1] === 'true';
                      aggressiveData.globalSettings.leadCollection.mandatory = correctMandatoryValue;
                    }

                    return aggressiveData;
                  }
                } catch (aggressiveError) {
                  console.error("[CourseCatalogueService] Failed aggressive extraction:", aggressiveError);
                }
                return this.getEmptyCatalogueData();
        }
      }
      
      // If no catalogue_json field, return the response as-is
      return response.data;
    } catch (error: any) {
      console.error("[CourseCatalogueService] Error fetching course catalogue:", error);

      // Check if it's a 404 error (tag not found)
      if (error?.response?.status === 404) {
        return this.getEmptyCatalogueData();
      }

      // Check if it's a network error
      if (error?.code === 'NETWORK_ERROR' || error?.message?.includes('Network Error')) {
        console.error("[CourseCatalogueService] Network error detected");
        throw new Error("Network error: Unable to connect to the server. Please check your internet connection.");
      }

      // Check if it's a timeout error
      if (error?.code === 'ECONNABORTED' || error?.message?.includes('timeout')) {
        console.error("[CourseCatalogueService] Timeout error detected");
        throw new Error("Request timeout: The server took too long to respond. Please try again.");
      }
      
      // For any other error, throw it to be handled by the component
      throw error;
    }
  }

  private static getEmptyCatalogueData(): CourseCatalogueData {
    return {
      globalSettings: {
        courseCatalogeType: {
          enabled: false,
          value: ""
        },
        mode: "light",
        compactness: "medium",
        audience: "all",
        leadCollection: {
          enabled: false,
          mandatory: false,
          inviteLink: null,
          formStyle: {
            type: "single",
            showProgress: false,
            progressType: "bar",
            transition: "slide"
          },
          fields: []
        },
        enrquiry: {
          enabled: true,
          requirePayment: false
        },
        payment: {
          enabled: true,
          provider: "razorpay",
          fields: []
        }
      },
      introPage: {
        enabled: false,
        fullScreen: true,
        showHeader: false,
        logo: {
          height: "80px",
          alignment: "center"
        },
        imageSlider: {
          autoPlay: true,
          interval: 3000,
          images: [],
          styles: {
            height: "70vh",
            objectFit: "contain",
            transitionEffect: "fade"
          }
        },
        actions: {
          alignment: "bottom",
          buttons: []
        },
        afterIntro: {
          action: "loadAllSections",
          target: "globalSettings.sections"
        }
      },
      pages: [
        {
          id: "empty",
          route: "empty",
          title: `No ${getTerminologyPlural(ContentTerms.Course, SystemTerms.Course)} Found`,
          components: [
            {
              id: "empty-1",
              type: "banner",
              enabled: true,
              props: {
                title: `No ${getTerminologyPlural(ContentTerms.Course, SystemTerms.Course).toLowerCase()} found for this tag`,
                media: { type: "image", url: "/api/placeholder/800/400" },
                alignment: "center"
              }
            },
            {
              id: "empty-2",
              type: "footer",
              enabled: true,
              props: {
                description: "Please check back later or try a different tag."
              }
            }
          ]
        }
      ]
    };
  }

}
