import { GripVertical } from "lucide-react";
import * as ResizablePrimitive from "react-resizable-panels";

import { cn } from "@/lib/utils";

const ResizablePanelGroup = ({ className, ...props }: React.ComponentProps<typeof ResizablePrimitive.PanelGroup>) => (
  <ResizablePrimitive.PanelGroup
    className={cn("flex h-full w-full data-[panel-group-direction=vertical]:flex-col", className)}
    {...props}
  />
);

const ResizablePanel = ResizablePrimitive.Panel;

const ResizableHandle = ({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelResizeHandle> & {
  withHandle?: boolean;
}) => (
  <ResizablePrimitive.PanelResizeHandle
    className={cn(
      "relative z-20 flex items-center justify-center touch-none select-none group bg-background/60 hover:bg-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 data-[panel-group-direction=horizontal]:w-5 data-[panel-group-direction=horizontal]:h-full data-[panel-group-direction=vertical]:h-5 data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=horizontal]:cursor-col-resize data-[panel-group-direction=vertical]:cursor-row-resize after:absolute after:bg-border after:opacity-80 group-hover:after:opacity-100 data-[panel-group-direction=horizontal]:after:inset-y-0 data-[panel-group-direction=horizontal]:after:left-1/2 data-[panel-group-direction=horizontal]:after:w-[2px] data-[panel-group-direction=horizontal]:after:-translate-x-1/2 data-[panel-group-direction=vertical]:after:inset-x-0 data-[panel-group-direction=vertical]:after:top-1/2 data-[panel-group-direction=vertical]:after:h-[2px] data-[panel-group-direction=vertical]:after:-translate-y-1/2 [&[data-panel-group-direction=vertical]>div]:rotate-90",
      className,
    )}
    {...props}
  >
    {withHandle && (
      <div className="z-10 flex h-4 w-4 items-center justify-center rounded-sm border border-border bg-background shadow-sm">
        <GripVertical className="h-2.5 w-2.5 text-muted-foreground" />
      </div>
    )}
  </ResizablePrimitive.PanelResizeHandle>
);

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
