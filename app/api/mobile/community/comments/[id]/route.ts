import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { deleteComment, findCommentById, findUserById } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

// DELETE /api/mobile/community/comments/[id] — author-only. No edit, no
// staff override here (staff removal goes through the report/resolve flow
// instead, which also closes out the report that prompted it).
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = verifyRequestSession(request);
  if (!session) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }
  const me = findUserById(session.userId);
  if (!me) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const comment = findCommentById(id);
  if (!comment) {
    return NextResponse.json({ success: false, message: "Comment not found." }, { status: 404 });
  }
  if (comment.userId !== me.id) {
    return NextResponse.json({ success: false, message: "You can only delete your own comments." }, { status: 403 });
  }

  deleteComment(id);

  return NextResponse.json({ success: true, message: "Deleted." });
}
