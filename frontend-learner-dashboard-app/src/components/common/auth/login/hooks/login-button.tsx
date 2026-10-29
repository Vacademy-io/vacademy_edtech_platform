import { z } from "zod";
import { LOGIN_URL } from "@/constants/urls";
import { Storage } from "@capacitor/storage";
import { TokenKey } from "@/constants/auth/tokens";
// import { INSTITUTE_ID } from "@/constants/urls";

// Define the request and response schemas using Zod
const loginRequestSchema = z.object({
    user_name: z.string(),
    password: z.string(),
    client_name: z.literal("ADMIN_PORTAL"),
    institute_id: z.string().uuid(),
});

const loginResponseSchema = z.object({
    accessToken: z.string(),
    refreshToken: z.string(),
    instituteId: z.string(),
});

// Custom error for session limit exceeded
export class SessionLimitError extends Error {
    activeSessions: any[];
    constructor(activeSessions: any[]) {
        super("Session limit exceeded");
        this.name = "SessionLimitError";
        this.activeSessions = activeSessions;
    }
}

// The credentials were right, but the account belongs to another institute than the
// portal being signed into. Not a credentials failure: retrying other casings of the
// same password cannot help.
export class PortalAccessError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PortalAccessError";
    }
}

const NOT_A_PORTAL_MEMBER_MARKER = "not registered with this institute";

// Single credential attempt against the login endpoint. Returns the parsed
// token payload, or throws (SessionLimitError for a valid-but-capped account,
// a plain Error for any other failure).
async function attemptLogin(
    userName: string,
    password: string,
    portalInstituteId?: string | null,
): Promise<z.infer<typeof loginResponseSchema>> {
    const response = await fetch(LOGIN_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            user_name: userName,
            password: password,
            client_name: "ADMIN_PORTAL",
            // institute_id: INSTITUTE_ID,
            // Login pages only: lets the server keep a white-label portal to its own learners.
            ...(portalInstituteId && { portal_institute_id: portalInstituteId }),
        }),
    });

    if (!response.ok) {
        const body = await response.json().catch(() => null);
        const serverMessage: unknown = body?.ex;
        if (
            typeof serverMessage === "string" &&
            serverMessage.includes(NOT_A_PORTAL_MEMBER_MARKER)
        ) {
            throw new PortalAccessError(serverMessage);
        }
        throw new Error("Login failed");
    }

    const tokenData = await response.json();

    // Check for session limit exceeded BEFORE storing tokens
    if (tokenData.session_limit_exceeded === true) {
        throw new SessionLimitError(tokenData.active_sessions || []);
    }

    return tokenData;
}

// Dummy login function
async function loginUser(
    username: string,
    password: string,
    convertToLowercase?: boolean | null,
    portalInstituteId?: string | null,
): Promise<z.infer<typeof loginResponseSchema>> {
    let tokenData: z.infer<typeof loginResponseSchema>;

    if (convertToLowercase === true) {
        // Try the lowercased credentials first (per institute config), but if
        // that is rejected, fall back to the values exactly as the user typed
        // them — some accounts were created with mixed-case usernames/passwords.
        try {
            tokenData = await attemptLogin(
                username.toLowerCase(),
                password.toLowerCase(),
                portalInstituteId,
            );
        } catch (error) {
            // A capped-but-valid account isn't a credentials failure — don't
            // retry, surface the session-limit dialog instead.
            if (error instanceof SessionLimitError || error instanceof PortalAccessError) {
                throw error;
            }
            tokenData = await attemptLogin(username, password, portalInstituteId);
        }
    } else {
        tokenData = await attemptLogin(username, password, portalInstituteId);
    }

    // --- BUG FIX: Save tokens and instituteId to storage ---
    try {
        await Storage.set({ key: TokenKey.accessToken, value: tokenData.accessToken });
        await Storage.set({ key: TokenKey.refreshToken, value: tokenData.refreshToken });
        await Storage.set({ key: "instituteId", value: tokenData.instituteId });
    } catch (error) {
        console.error("Error saving tokens to storage", error);
        // If we can't save tokens, the login is effectively failed.
        throw new Error("Failed to save session.");
    }

    return tokenData;
}

export { loginUser, loginRequestSchema, loginResponseSchema };
