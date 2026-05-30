import { GeneratorTool } from "@/components/GeneratorTool";
import { PageHeader } from "@/components/ui";
import { BOOKKEEPING_TYPES } from "@/lib/constants";

export default function BookkeepingAI() {
  return (
    <div>
      <PageHeader
        title="Bookkeeping AI"
        subtitle="AI-powered financial documents — expense reports, invoices, budgets and financial briefs"
      />
      <GeneratorTool tool="bookkeeping" formats={BOOKKEEPING_TYPES} />
    </div>
  );
}
