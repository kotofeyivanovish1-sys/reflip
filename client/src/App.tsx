import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { AuthProvider, useAuth } from "@/lib/auth";
import Auth from "@/pages/Auth";
import Dashboard from "@/pages/Dashboard";
import Listings from "@/pages/Listings";
import NewListing from "@/pages/NewListing";
import Bags from "@/pages/Bags";
import EditListing from "@/pages/EditListing";
import Scanner from "@/pages/Scanner";
import Analytics from "@/pages/Analytics";
import NotFound from "@/pages/not-found";

function AppInner() {
  const { user, loading } = useAuth();

  if (loading) return (
    <div className="min-h-screen gradient-mesh flex items-center justify-center">
      <div className="w-10 h-10 rounded-full pulse-glow"
        style={{ background: "linear-gradient(135deg, hsl(250 80% 58%), hsl(280 70% 60%))" }} />
    </div>
  );

  if (!user) return <Auth />;

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/listings" component={Listings} />
          <Route path="/listings/new" component={NewListing} />
          <Route path="/bags" component={Bags} />
          <Route path="/listings/:id/edit" component={EditListing} />
          <Route path="/scanner" component={Scanner} />
          <Route path="/analytics" component={Analytics} />
          <Route component={NotFound} />
        </Switch>
      </SidebarInset>
    </SidebarProvider>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router hook={useHashLocation}>
        <AuthProvider>
          <AppInner />
        </AuthProvider>
      </Router>
      <Toaster />
    </QueryClientProvider>
  );
}
