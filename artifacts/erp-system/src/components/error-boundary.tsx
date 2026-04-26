import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (typeof window !== "undefined") {
      console.error("ErrorBoundary caught:", error, errorInfo);
    }
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  handleGoHome = () => {
    this.setState({ hasError: false, error: null });
    window.location.href = import.meta.env.BASE_URL;
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-background" dir="rtl">
          <div className="max-w-md w-full text-center space-y-6">
            <div className="mx-auto grid size-16 place-items-center rounded-full bg-red-500/10 text-red-600">
              <AlertTriangle className="size-8" />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-bold">حدث خطأ غير متوقع</h1>
              <p className="text-muted-foreground">
                نعتذر عن هذا الانقطاع. يمكنك إعادة تحميل الصفحة أو العودة للرئيسية.
              </p>
              {this.state.error?.message && (
                <p className="mt-4 rounded-lg bg-muted p-3 text-left text-xs font-mono text-muted-foreground" dir="ltr">
                  {this.state.error.message}
                </p>
              )}
            </div>
            <div className="flex gap-3 justify-center">
              <Button onClick={this.handleReload}>إعادة تحميل</Button>
              <Button variant="outline" onClick={this.handleGoHome}>الرئيسية</Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
