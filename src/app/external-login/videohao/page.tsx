import VideohaoExternalLoginGuideClient from "./videohao-guide-client";

export default function VideohaoExternalLoginGuidePage({
  searchParams,
}: {
  searchParams?: {
    loginUrl?: string;
    sessionToken?: string;
    platform?: string;
  };
}) {
  return (
    <VideohaoExternalLoginGuideClient
      loginUrl={String(searchParams?.loginUrl || "").trim()}
      sessionToken={String(searchParams?.sessionToken || "").trim()}
      platform={String(searchParams?.platform || "videohao").trim() || "videohao"}
    />
  );
}
