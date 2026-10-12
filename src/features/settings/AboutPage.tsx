import { useTranslation } from "react-i18next";
import { Card, PageHeader } from "@/components/ui/misc";
import { About } from "./About";

export function AboutPage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex max-w-3xl flex-col">
      <PageHeader title={t("nav.about")} subtitle={t("about.tagline")} />
      <Card className="p-5">
        <About />
      </Card>
    </div>
  );
}
