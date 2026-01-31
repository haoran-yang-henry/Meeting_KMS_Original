import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Upload } from "lucide-react";

export const AdditionalContext = () => {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Additional Context</CardTitle>
          <Badge variant="outline" className="text-xs">DR2 + DR3</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Project and Group Selection */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">Project</label>
            <Select defaultValue="project-a">
              <SelectTrigger>
                <SelectValue placeholder="Select project" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="project-a">Project A</SelectItem>
                <SelectItem value="project-b">Project B</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">Group</label>
            <Select defaultValue="group-a">
              <SelectTrigger>
                <SelectValue placeholder="Select group" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="group-a">Group A</SelectItem>
                <SelectItem value="group-b">Group B</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Glossary / Meeting Context */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-muted-foreground">Glossary / Meeting Context</label>
          <Textarea
            placeholder={`e.g., [PERSON1] = Name (Role)\n[ORGANIZATION1] = Company Name\n[Project] = Full description`}
            className="min-h-[100px] resize-none"
          />
        </div>

        {/* Knowledge Files Upload */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-muted-foreground">
            Upload knowledge files (playbooks, specs, minutes)
          </label>
          <div className="border-2 border-dashed rounded-lg p-4 text-center hover:border-primary transition-colors cursor-pointer">
            <Upload className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm font-medium mb-1">Choose Files</p>
            <p className="text-xs text-muted-foreground">No file chosen</p>
          </div>
          <p className="text-xs text-muted-foreground">
            Context will be reused for similar meetings and corrections.
          </p>
          <Button size="sm" className="w-full">
            Attach to meeting
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
