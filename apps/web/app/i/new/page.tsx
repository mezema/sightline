import { Suspense } from "react";
import { ComposeForm } from "../../_components/compose-form";

export default function NewInspectionPage() {
  return (
    <main className="canvas">
      <Suspense fallback={null}>
        <ComposeForm />
      </Suspense>
    </main>
  );
}
