import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Candidate } from "@/lib/api";
import { extractCareerDocument } from "@/lib/cv-documents";

export function CareerSourcePanel({
  candidate,
  onImportLinkedIn,
  onUploadCv,
  onFindJobs,
}: {
  candidate: Candidate;
  onImportLinkedIn: (url: string) => Promise<void>;
  onUploadCv: (filename: string, text: string) => Promise<void>;
  onFindJobs: () => Promise<void>;
}) {
  const [linkedinUrl, setLinkedinUrl] = useState(candidate.linkedin_url ?? "");
  const [linkedinConsent, setLinkedinConsent] = useState(false);
  const [busy, setBusy] = useState<"linkedin" | "cv" | "jobs" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const run = async (kind: "linkedin" | "cv" | "jobs", action: () => Promise<void>) => {
    setBusy(kind); setError(""); setNotice("");
    try { await action(); setNotice(kind === "linkedin" ? "LinkedIn profile imported. Review the information below before confirming your profile." : kind === "cv" ? "CV uploaded and added to your career profile." : "LinkedIn job search completed."); }
    catch (e) { setError(e instanceof Error ? e.message : "The action could not be completed."); }
    finally { setBusy(null); }
  };
  return (
    <section className="rounded-2xl border bg-card p-4 shadow-soft sm:p-5 space-y-4">
      <div>
        <h3 className="font-semibold text-base">Build your real career profile</h3>
        <p className="mt-1 text-sm text-muted-foreground">Bring your LinkedIn experience and CV together. Your information stays yours, and imported details are not treated as confirmed until you review them.</p>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="career-linkedin-url">LinkedIn profile URL</label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input id="career-linkedin-url" value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} placeholder="https://www.linkedin.com/in/your-profile/" />
          <Button disabled={busy !== null || !linkedinUrl.trim() || !linkedinConsent} onClick={() => void run("linkedin", () => onImportLinkedIn(linkedinUrl.trim()))}>{busy === "linkedin" ? "Importing…" : "Import LinkedIn"}</Button>
        </div>
        <label className="flex items-start gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={linkedinConsent} onChange={(e) => setLinkedinConsent(e.target.checked)} className="mt-0.5" />I authorize Hired Not Tired to retrieve my LinkedIn public profile information through its connected Needle account for my career profile.</label>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="career-cv-file">Upload your CV</label>
        <Input id="career-cv-file" type="file" accept=".pdf,.docx,.txt,.md" disabled={busy !== null} onChange={(e) => {
          const file = e.target.files?.[0]; if (!file) return;
          void run("cv", async () => { const extracted = await extractCareerDocument(file); await onUploadCv(extracted.filename, extracted.text); });
          e.currentTarget.value = "";
        }} />
        <p className="text-xs text-muted-foreground">PDF, DOCX, TXT or Markdown. Maximum 5 MB.</p>
      </div>
      <div className="border-t pt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-sm font-medium">Find jobs that match your profile</p><p className="text-xs text-muted-foreground">Searches LinkedIn through your connected Needle account.</p></div>
        <Button disabled={busy !== null} onClick={() => void run("jobs", onFindJobs)}>{busy === "jobs" ? "Searching…" : "Find matching jobs"}</Button>
      </div>
      {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </section>
  );
}
