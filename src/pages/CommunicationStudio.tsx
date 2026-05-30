import { GeneratorTool } from "@/components/GeneratorTool";
import { PageHeader } from "@/components/ui";
import { STUDIO_FORMATS } from "@/lib/constants";

export default function CommunicationStudio() {
  return (
    <div>
      <PageHeader
        title="Communication Studio"
        subtitle="AI-powered writing for every executive communication need — powered by Claude"
      />
      <GeneratorTool tool="studio" formats={STUDIO_FORMATS} />
    </div>
  );
}
