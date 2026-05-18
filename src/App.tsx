import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FlashCommandoProvider } from "@/contexts/FlashCommandoContext";
import FlashCommandoOverlay from "@/components/game/FlashCommandoOverlay";
import Index from "./pages/Index";
import PartyPage from "./pages/PartyPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <FlashCommandoProvider>
        <Toaster />
        <FlashCommandoOverlay />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/party/:code" element={<PartyPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </FlashCommandoProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
