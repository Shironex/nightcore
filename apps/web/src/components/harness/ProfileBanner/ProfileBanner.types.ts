import type { RepoProfileVM } from '../harness.types';

export interface ProfileBannerProps {
  /** The detected repo profile, or `null` before `harness-profile-ready` lands. */
  profile: RepoProfileVM | null;
  /** Whether a scan is in flight — renders a skeleton when the profile is null. */
  loading: boolean;
}
