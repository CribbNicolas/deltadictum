using Patriark.Domain.Decisions;
using Patriark.Infrastructure.Persistence;
using Xunit;

namespace Patriark.Tests;

public sealed class ZzBenchShortHash
{
    // The prompt names SnapshotCodec.ShortHash(GameState); StateHash is an instance method, so either
    // a static or an instance ShortHash follows the codebase. Reflection calls whichever was written.
    [Fact]
    public async Task ShortHashIsTheStateHashPrefix()
    {
        var session = await ZzBenchSession.Open(new AlternatingSaveStore(ZzBenchSession.Folder()));
        var state = session.DiagnosticSnapshot();
        var codec = new SnapshotCodec();
        var method = typeof(SnapshotCodec).GetMethods().Single(m => m.Name == "ShortHash" && m.GetParameters().Length == 1);
        var shortHash = (string?)method.Invoke(method.IsStatic ? null : codec, new object[] { state });
        Assert.Equal(codec.StateHash(state)[..12].ToLowerInvariant(), shortHash);
    }
}
