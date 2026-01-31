import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Send } from "lucide-react";

export const ChatWithSummary = () => {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Chat with Summary</CardTitle>
          <Badge variant="outline" className="text-xs">DR7</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Tone and Focus Controls */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase">Tone</label>
            <Select defaultValue="concise">
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="concise">Concise</SelectItem>
                <SelectItem value="detailed">Detailed</SelectItem>
                <SelectItem value="formal">Formal</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase">Focus</label>
            <Select defaultValue="decisions">
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="decisions">Decisions</SelectItem>
                <SelectItem value="action-items">Action Items</SelectItem>
                <SelectItem value="discussions">Discussions</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Chat Message */}
        <div className="bg-muted/50 rounded-lg p-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            You are viewing the AI-generated meeting summary for Project A.
          </p>
          <div className="bg-primary text-primary-foreground rounded-lg p-3">
            <p className="text-sm">
              Give me a shorter version focused on decisions only.
            </p>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Main decisions:</p>
            <ol className="text-sm space-y-1 list-decimal list-inside">
              <li>Proceed with GenAI chatbot rollout</li>
              <li>Platform group owns deployment</li>
              <li>Follow-up on data ownership next Tuesday.</li>
            </ol>
          </div>
        </div>

        {/* Chat Input */}
        <div className="flex gap-2">
          <Input placeholder="Ask something about this meeting..." className="flex-1" />
          <Button size="icon">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
