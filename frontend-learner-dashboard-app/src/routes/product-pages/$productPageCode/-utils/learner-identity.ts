/**
 * Moved to `@/lib/learner-identity` so the enrol-invite form can share it —
 * it was picking the learner's email by substring-matching field keys, which
 * silently yields no identity on any institute that names its fields
 * differently, and a touch with no identity is dropped on the floor.
 *
 * Re-exported here so the product-page call sites stay unchanged.
 */
export {
    resolveLearnerIdentity,
    type LearnerIdentity,
    type IdentityCandidate,
} from '@/lib/learner-identity';
