import { useLanguage } from "@/hooks/use-language";

export default function HelpPage() {
  const { language } = useLanguage();
  return (
    <div className="h-[calc(100vh-4rem)] w-full">
      <iframe
        title={language === "ar" ? "دليل المستخدم" : "User Manual"}
        src={`/docs/?embed=1&lang=${language}`}
        key={language}
        className="h-full w-full border-0"
        data-testid="iframe-docs"
      />
    </div>
  );
}
