import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Auth from "./pages/Auth";
import Index from "./pages/Index";
import Search from "./pages/Search";
import Dashboard from "./pages/Dashboard";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route element={<ProtectedRoute />}>
              <Route path="/" element={<Index />} />
              <Route path="/search" element={<Search />} />
              <Route path="/today" element={<Dashboard viewType="timeline" viewName="Today" />} />
              <Route path="/week" element={<Dashboard viewType="timeline" viewName="This Week" />} />
              <Route path="/month" element={<Dashboard viewType="timeline" viewName="This Month" />} />
              <Route path="/topic/:topicName" element={<Dashboard viewType="topic" />} />
              <Route path="/project/:projectName" element={<Dashboard viewType="project" />} />
              <Route path="/group/:groupName" element={<Dashboard viewType="group" />} />
              {/* Legacy routes for backward compatibility */}
              <Route path="/:slug" element={<Dashboard viewType="project" />} />
            </Route>
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
