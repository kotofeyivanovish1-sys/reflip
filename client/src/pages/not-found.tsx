import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex items-center justify-center h-full flex-col gap-4">
      <p className="text-4xl font-bold text-muted-foreground/30">404</p>
      <p className="text-muted-foreground text-sm">Page not found</p>
      <Button asChild size="sm" variant="outline"><Link href="/">Go home</Link></Button>
    </div>
  );
}
