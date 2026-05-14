import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { FolderPlus, FileText, Plus, FilePenLine } from "lucide-react";
import { apiGet, apiPost } from "@/hooks/use-api";

type Folder = { id: number; name: string; parentId: number | null };
type Document = { id: number; title: string; folderId: number | null; currentVersionId: number | null; createdAt: string };

export default function DocumentsPage() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [activeFolder, setActiveFolder] = useState<number | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);

  const [newFolderName, setNewFolderName] = useState("");
  const [newDocTitle, setNewDocTitle] = useState("");
  const [newDocText, setNewDocText] = useState("");

  const [sigEmail, setSigEmail] = useState("");
  const [sigName, setSigName] = useState("");
  const [sigDocId, setSigDocId] = useState<number | null>(null);

  const loadFolders = async () => {
    const r = await apiGet<{ folders: Folder[] }>("/documents/folders");
    setFolders(r.folders ?? []);
  };

  const loadDocuments = async (folderId: number | null) => {
    const q = folderId ? `?folderId=${folderId}` : "";
    const r = await apiGet<{ documents: Document[] }>(`/documents${q}`);
    setDocuments(r.documents ?? []);
  };

  useEffect(() => { loadFolders(); loadDocuments(null); }, []);
  useEffect(() => { loadDocuments(activeFolder); }, [activeFolder]);

  const createFolder = async () => {
    if (!newFolderName.trim()) return;
    await apiPost("/documents/folders", { name: newFolderName, parentId: activeFolder });
    setNewFolderName("");
    loadFolders();
  };

  const createDoc = async () => {
    if (!newDocTitle.trim()) return;
    await apiPost("/documents", {
      title: newDocTitle,
      folderId: activeFolder,
      content: newDocText,
      mimeType: "text/plain",
    });
    setNewDocTitle(""); setNewDocText("");
    loadDocuments(activeFolder);
  };

  const requestSignature = async () => {
    if (!sigDocId || !sigEmail.trim() || !sigName.trim()) return;
    const r = await apiPost<{ id: number; signers: Array<{ signUrl: string; email: string }> }>(
      "/documents/signatures",
      { documentId: sigDocId, signers: [{ email: sigEmail, name: sigName }] },
    );
    alert(`تم إنشاء طلب التوقيع. روابط التوقيع:\n${r.signers.map((s) => `${s.email}: ${s.signUrl}`).join("\n")}`);
    setSigEmail(""); setSigName(""); setSigDocId(null);
  };

  return (
    <div className="p-3 sm:p-4 md:p-6 space-y-4" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold">إدارة الوثائق</h1>
        <p className="text-muted-foreground text-sm">مجلدات، نسخ، توقيع إلكتروني</p>
      </div>

      <div className="grid gap-4 md:grid-cols-[260px_1fr]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">المجلدات</CardTitle>
            <Dialog>
              <DialogTrigger asChild>
                <Button size="icon" variant="ghost"><FolderPlus className="size-4" /></Button>
              </DialogTrigger>
              <DialogContent dir="rtl">
                <DialogHeader><DialogTitle>مجلد جديد</DialogTitle></DialogHeader>
                <Input placeholder="اسم المجلد" value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} />
                <Button onClick={createFolder}>إنشاء</Button>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent className="space-y-1">
            <button
              onClick={() => setActiveFolder(null)}
              className={`w-full text-right px-3 py-2 rounded text-sm ${activeFolder === null ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              الجذر
            </button>
            {folders.map((f) => (
              <button
                key={f.id}
                onClick={() => setActiveFolder(f.id)}
                className={`w-full text-right px-3 py-2 rounded text-sm ${activeFolder === f.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              >
                {f.name}
              </button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">الوثائق</CardTitle>
            <Dialog>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="size-4 ml-1" /> وثيقة جديدة</Button>
              </DialogTrigger>
              <DialogContent dir="rtl">
                <DialogHeader><DialogTitle>وثيقة جديدة</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <Input placeholder="عنوان الوثيقة" value={newDocTitle} onChange={(e) => setNewDocTitle(e.target.value)} />
                  <Textarea placeholder="المحتوى النصي" rows={6} value={newDocText} onChange={(e) => setNewDocText(e.target.value)} />
                  <Button onClick={createDoc}>إنشاء</Button>
                </div>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>العنوان</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">لا توجد وثائق</TableCell></TableRow>
                )}
                {documents.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="flex items-center gap-2"><FileText className="size-4" /> {d.title}</TableCell>
                    <TableCell>{new Date(d.createdAt).toLocaleDateString("ar-SA")}</TableCell>
                    <TableCell><Badge variant="outline">{d.currentVersionId ? "نسخة جاهزة" : "فارغة"}</Badge></TableCell>
                    <TableCell>
                      <Dialog onOpenChange={(o) => { if (o) setSigDocId(d.id); }}>
                        <DialogTrigger asChild>
                          <Button size="sm" variant="outline"><FilePenLine className="size-4 ml-1" /> طلب توقيع</Button>
                        </DialogTrigger>
                        <DialogContent dir="rtl">
                          <DialogHeader><DialogTitle>طلب توقيع إلكتروني</DialogTitle></DialogHeader>
                          <div className="space-y-3">
                            <Input placeholder="اسم الموقّع" value={sigName} onChange={(e) => setSigName(e.target.value)} />
                            <Input type="email" placeholder="بريد الموقّع" value={sigEmail} onChange={(e) => setSigEmail(e.target.value)} />
                            <Button onClick={requestSignature}>إرسال الطلب</Button>
                          </div>
                        </DialogContent>
                      </Dialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
